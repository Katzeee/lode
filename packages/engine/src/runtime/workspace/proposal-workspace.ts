import type {
  EngineCommand,
  EngineEvent,
  EngineQuery,
  EngineQueryInput,
  EngineQueryKind,
  EngineQueryValue,
  EngineQueryValueForKind,
  Unsubscribe,
  WriteResult,
} from "@lode/sdk";
import { parseEngineCommand, type AcceptedEngineCommand } from "../../application/input-validation.js";
import type { ProjectionVersions } from "../../domain/reconcile/index.js";
import type { FactAuthority } from "../authority/fact-authority.js";
import { SerialExecutor } from "../kernel/serial-executor.js";
import { ensureWorkspaceGenesis, WorkspaceAuthorityLifecycle } from "./authority-lifecycle/index.js";
import { WorkspaceCommandExecutor } from "./command/index.js";
import { WorkspaceProjectionLifecycle, type ProjectionLifecycleOptions } from "./projection-lifecycle/index.js";
import { queryWorkspace } from "./query/index.js";
import { rejectedResult } from "./workspace-results.js";
import { WorkspaceSignals } from "./workspace-signals.js";

export type ProposalWorkspaceOptions = Readonly<{
  workspaceId: string;
  facts: FactAuthority;
  versions: ProjectionVersions;
  reviewCapabilityKey?: string;
  projection?: ProjectionLifecycleOptions;
  /**
   * Seed an untitled genesis transaction into an empty journal. Only for
   * ungoverned engine-local contexts; production hosts own genesis through
   * governed creation (attributed to the owner Actor) or staged adoption.
   */
  seedGenesis?: boolean;
}>;

export class ProposalWorkspace {
  private readonly commands: WorkspaceCommandExecutor;
  private readonly authority: WorkspaceAuthorityLifecycle;
  private readonly serial = new SerialExecutor();
  private stopped = false;
  private constructor(
    private readonly options: ProposalWorkspaceOptions,
    private readonly projection: WorkspaceProjectionLifecycle,
    private readonly signals: WorkspaceSignals,
  ) {
    this.commands = new WorkspaceCommandExecutor({
      workspaceId: options.workspaceId,
      facts: options.facts,
      projection,
      signals: this.signals,
      ...(options.reviewCapabilityKey ? { reviewCapabilityKey: options.reviewCapabilityKey } : {}),
    });
    this.authority = new WorkspaceAuthorityLifecycle({
      facts: options.facts,
      projection,
      signals: this.signals,
    });
  }
  static async open(options: ProposalWorkspaceOptions): Promise<ProposalWorkspace> {
    if (options.seedGenesis !== false) {
      await ensureWorkspaceGenesis(options.workspaceId, options.facts);
    }
    const admission = options.facts.admission();
    const authorityFault = admission.kind === "fault" ? (admission.fault ?? "Authority admission fault") : null;
    const signals = new WorkspaceSignals(options.workspaceId, authorityFault);
    const projection = await WorkspaceProjectionLifecycle.open(
      options.workspaceId,
      admission.snapshot,
      options.versions,
      options.projection,
      (event) => signals.emit(event.kind, event.frontier, event.generationId),
    );
    return new ProposalWorkspace(options, projection, signals);
  }
  get workspaceId(): string {
    return this.options.workspaceId;
  }
  get authorityFaulted(): boolean {
    return this.signals.authorityFaulted;
  }
  async execute(command: EngineCommand): Promise<WriteResult> {
    let accepted: AcceptedEngineCommand;
    try {
      accepted = parseEngineCommand(command);
    } catch (error) {
      return this.rejected("invalid-input", error instanceof Error ? error.message : String(error));
    }
    return this.executeAccepted(accepted);
  }
  async executeAccepted(command: AcceptedEngineCommand): Promise<WriteResult> {
    if (this.stopped) {
      return this.rejected("projection-unavailable", "Workspace is closed");
    }
    return this.serial.run(() => this.executeExclusive(command));
  }
  private async executeExclusive(command: AcceptedEngineCommand): Promise<WriteResult> {
    if (this.stopped) {
      return this.rejected("projection-unavailable", "Workspace is closed");
    }
    return this.commands.execute(command);
  }
  async query<Kind extends EngineQueryKind>(query: EngineQueryInput<Kind>): Promise<EngineQueryValueForKind<Kind>>;
  async query(query: EngineQuery): Promise<EngineQueryValue> {
    return queryWorkspace(query, {
      workspaceId: this.options.workspaceId,
      facts: this.options.facts,
      snapshot: this.projection.publishedSnapshot,
      projections: this.projection.projections,
      generationId: this.projection.identity.generationId,
      projectionFailure: this.projection.failure,
      ...(this.options.reviewCapabilityKey ? { reviewCapabilityKey: this.options.reviewCapabilityKey } : {}),
    });
  }
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe {
    return this.signals.subscribe(listener);
  }

  async reconcileAuthorityAdvance(): Promise<void> {
    if (this.stopped) {
      return;
    }
    return this.serial.run(() => this.authority.reconcileAdvance());
  }

  async recoverAuthority(): Promise<void> {
    if (this.stopped) {
      throw new Error("Workspace is closed");
    }
    return this.serial.run(() => this.authority.recover());
  }

  async close(): Promise<void> {
    this.stopped = true;
    await this.serial.run(() => Promise.resolve());
    this.signals.clear();
  }

  private rejected(code: Parameters<typeof rejectedResult>[0], message: string): ReturnType<typeof rejectedResult> {
    return rejectedResult(code, message, this.projection.identity.generationId);
  }
}
