import type {
  EngineCommand,
  EngineQuery,
  EngineQueryInput,
  EngineQueryKind,
  EngineQueryValue,
  EngineQueryValueForKind,
  WriteResult,
} from "@lode/sdk";
import { parseEngineCommand, type AcceptedEngineCommand } from "./application/input-validation.js";
import type { ProjectionVersions } from "../../domain/reconcile/index.js";
import type { FactAuthorityPort, ReplicatedFactAuthorityPort } from "./authority/authority-contract.js";
import type { SyncableDoc } from "./replica-sync.js";
import { SerialExecutor } from "./serial-executor.js";
import { ensureWorkspaceGenesis, WorkspaceAuthorityCoordinator } from "./authority-coordination/index.js";
import { WorkspaceCommandExecutor } from "./command/index.js";
import { WorkspaceProjection } from "./projection/index.js";
import { queryWorkspace } from "./query/index.js";
import { rejectedResult } from "./workspace-results.js";
import { WorkspaceEventPublisher } from "./workspace-event-publisher.js";
import type { EventSink } from "../event/index.js";
import type { WorkspaceStorage } from "../persistence/index.js";
import { validateWorkspaceSnapshot } from "./workspace-validation.js";

type WorkspaceOptions = Readonly<{
  workspaceId: string;
  facts: ReplicatedFactAuthorityPort;
  versions: ProjectionVersions;
  /**
   * Seed an untitled genesis Fact into an empty authority. Only for
   * ungoverned engine-local contexts; production hosts own genesis through
   * governed creation (attributed to the owner Actor) or staged adoption.
   */
  seedGenesis?: boolean;
  eventSink?: EventSink;
  storage?: WorkspaceStorage;
}>;

export class Workspace {
  private readonly commands: WorkspaceCommandExecutor;
  private readonly authority: WorkspaceAuthorityCoordinator;
  private readonly serial = new SerialExecutor();
  private stopped = false;
  private constructor(
    private readonly options: WorkspaceOptions,
    private readonly projection: WorkspaceProjection,
    events: WorkspaceEventPublisher,
  ) {
    this.commands = new WorkspaceCommandExecutor({
      workspaceId: options.workspaceId,
      facts: options.facts,
      projection,
      events,
    });
    this.authority = new WorkspaceAuthorityCoordinator({
      facts: options.facts,
      projection,
      events,
    });
  }
  static async open(options: WorkspaceOptions): Promise<Workspace> {
    if (options.seedGenesis !== false) {
      await ensureWorkspaceGenesis(options.workspaceId, options.facts);
    }
    const snapshot = options.facts.snapshot();
    const events = new WorkspaceEventPublisher(options.workspaceId, options.eventSink);
    const projection = WorkspaceProjection.open(options.workspaceId, snapshot, options.versions, (event) =>
      events.publish(event.kind, event.frontier, event.generationId),
    );
    return new Workspace(options, projection, events);
  }
  get workspaceId(): string {
    return this.options.workspaceId;
  }
  get label(): string {
    return this.validate().label;
  }
  validate(): Readonly<{ label: string }> {
    const state = this.projection.current;
    return validateWorkspaceSnapshot(this.workspaceId, state.snapshot, state.generation);
  }
  get facts(): FactAuthorityPort {
    return this.options.facts;
  }
  get replicationDocument(): SyncableDoc {
    return this.options.facts.replication;
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
    return this.serial.run(() => this.commands.execute(command));
  }
  async query<Kind extends EngineQueryKind>(query: EngineQueryInput<Kind>): Promise<EngineQueryValueForKind<Kind>>;
  async query(query: EngineQuery): Promise<EngineQueryValue> {
    if (this.stopped) {
      throw new Error("Workspace is closed");
    }
    return this.serial.run(() => this.queryExclusive(query));
  }
  private queryExclusive(query: EngineQuery): Promise<EngineQueryValue> {
    const state = this.projection.current;
    return queryWorkspace(query, {
      workspaceId: this.options.workspaceId,
      facts: this.options.facts,
      state,
      projectionFailure: this.projection.failure,
    });
  }
  async reconcileAuthorityAdvance(): Promise<void> {
    if (this.stopped) {
      return;
    }
    return this.serial.run(() => this.authority.reconcileAdvance());
  }

  async close(): Promise<void> {
    this.stopped = true;
    await this.serial.run(() => Promise.resolve());
    await this.options.storage?.release();
  }

  private rejected(code: Parameters<typeof rejectedResult>[0], message: string): ReturnType<typeof rejectedResult> {
    return rejectedResult(code, message, this.projection.identity.generationId);
  }
}
