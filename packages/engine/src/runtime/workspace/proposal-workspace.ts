import {
  frontierCovers,
  frontierEquals,
  requestDigest,
  type AuthorityReceipt,
  type FactSnapshot,
} from "../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
import type {
  EngineCommand,
  EngineEvent,
  EngineQuery,
  EngineQueryValue,
  RejectedResult,
  Unsubscribe,
  WriteResult,
} from "../../application/contract.js";
import type { FactStore } from "../authority/fact-store.js";
import { AuthorityFaultError } from "../authority/errors.js";
import { SerialExecutor } from "../kernel/serial-executor.js";
import {
  buildAndPublishGeneration,
  emitWorkspaceEvent,
  freezePublishedGeneration,
} from "./generation-publication.js";
import type {
  ProjectionGenerationStore,
  ProposalWorkspaceOptions,
} from "./proposal-workspace-types.js";
import { queryWorkspace } from "./workspace-query.js";
import {
  executionErrorResult,
  finishWorkspaceReceipt,
  pendingResult,
  publishedResult,
  rejectedResult,
} from "./workspace-results.js";
import { planWorkspaceCommand } from "./workspace-command-planner.js";
import { readCommandGeneration } from "./command-generation-reader.js";
import { openWorkspaceGeneration } from "./workspace-opening.js";

export class ProposalWorkspace {
  private generationIdentity: ProjectionGeneration["identity"];
  private publishedSnapshot: FactSnapshot;
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private readonly serial = new SerialExecutor();
  private projectionFailure: string | null = null;
  private authorityFault: string | null;
  private stopped = false;
  private constructor(
    private readonly options: ProposalWorkspaceOptions,
    private readonly generations: ProjectionGenerationStore,
    generation: ProjectionGeneration,
    publishedSnapshot: FactSnapshot,
    authorityFault: string | null,
  ) {
    this.generationIdentity = generation.identity;
    this.publishedSnapshot = publishedSnapshot;
    this.authorityFault = authorityFault;
  }
  static async open(options: ProposalWorkspaceOptions): Promise<ProposalWorkspace> {
    const opened = await openWorkspaceGeneration(options);
    return new ProposalWorkspace(
      options,
      opened.generations,
      opened.generation,
      opened.snapshot,
      opened.authorityFault,
    );
  }
  get workspaceId(): string {
    return this.options.workspaceId;
  }
  async execute(command: EngineCommand): Promise<WriteResult> {
    if (this.stopped) {
      return this.rejected("projection-unavailable", "Workspace is closed");
    }
    return this.serial.run(() => this.executeExclusive(command));
  }
  private async executeExclusive(command: EngineCommand): Promise<WriteResult> {
    try {
      if (this.stopped) {
        return this.rejected("projection-unavailable", "Workspace is closed");
      }
      if (command.workspaceId !== this.options.workspaceId) {
        return this.rejected("invalid-input", "Command belongs to another Workspace");
      }
      const existing = this.options.facts.receipt(command.invocationId);
      if (existing) {
        if (existing.requestDigest !== requestDigest(command)) {
          return this.rejected("invocation-conflict", "Invocation identity has another request");
        }
        return this.finishReceipt(existing);
      }
      const admission = this.options.facts.admission();
      if (admission.kind === "fault") {
        const fault = admission.fault ?? "Authority admission fault";
        this.noteAuthorityFault(fault);
        throw new AuthorityFaultError(fault);
      }
      this.authorityFault = null;
      if (!frontierEquals(this.generationIdentity.frontier, admission.snapshot.frontier)) {
        return this.rejected(
          "projection-unavailable",
          "Projection Generation does not cover the admitted authority frontier",
        );
      }
      const generation = await readCommandGeneration(
        this.generations,
        this.generationIdentity.generationId,
        this.publishedSnapshot,
        command,
      );
      const planned = planWorkspaceCommand(
        this.options.workspaceId,
        command,
        this.options.facts.snapshot(),
        generation,
        this.options.facts.receipts(),
        this.options.reviewCapabilityKey,
        this.options.historyPlanningObserver,
      );
      if ("status" in planned) {
        return planned;
      }
      const committed = await this.options.facts.commit({
        invocationId: command.invocationId,
        request: command,
        bodies: planned.bodies,
        lineage: planned.lineage,
        publishedFrontier: this.generationIdentity.frontier,
      });
      if (committed.created) {
        this.emit("authority-advanced", committed.receipt.committedFrontier, null, []);
      }
      return await this.publishToReceipt(committed.receipt);
    } catch (error) {
      return executionErrorResult(error, this.generationIdentity.generationId);
    }
  }
  async query(query: EngineQuery): Promise<EngineQueryValue> {
    return queryWorkspace(
      this.options.workspaceId,
      query,
      this.options.facts,
      this.publishedSnapshot,
      this.generations,
      this.generationIdentity.generationId,
      this.projectionFailure,
      this.options.reviewCapabilityKey,
      this.options.historyPlanningObserver,
    );
  }
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async reconcileAuthorityAdvance(): Promise<void> {
    if (this.stopped) {
      return;
    }
    return this.serial.run(() => this.reconcileAuthorityAdvanceExclusive());
  }

  private async reconcileAuthorityAdvanceExclusive(): Promise<void> {
    const admission = this.options.facts.admission();
    if (admission.kind === "fault") {
      this.noteAuthorityFault(admission.fault ?? "Authority admission fault");
      return;
    }
    this.authorityFault = null;
    const snapshot = admission.snapshot;
    if (frontierCovers(this.generationIdentity.frontier, snapshot.frontier)) {
      return;
    }
    this.emit("authority-advanced", snapshot.frontier, null, []);
    await this.publish(snapshot);
  }

  async recoverAuthority(): Promise<void> {
    if (this.stopped) {
      throw new Error("Workspace is closed");
    }
    return this.serial.run(async () => {
      if (this.options.facts.admission().kind !== "fault") {
        return;
      }
      const snapshot = await this.options.facts.recoverToLastValidPrefix();
      this.authorityFault = null;
      if (!frontierCovers(this.generationIdentity.frontier, snapshot.frontier)) {
        await this.publish(snapshot);
      }
      this.emit(
        "projection-recovered",
        snapshot.frontier,
        this.generationIdentity.generationId,
        [],
      );
    });
  }

  async close(): Promise<void> {
    this.stopped = true;
    await this.serial.run(() => Promise.resolve());
    this.listeners.clear();
  }

  private async finishReceipt(receipt: AuthorityReceipt): Promise<WriteResult> {
    if (frontierCovers(this.generationIdentity.frontier, receipt.committedFrontier)) {
      return publishedResult(receipt, this.generationIdentity.generationId);
    }
    return finishWorkspaceReceipt(
      receipt,
      this.generationIdentity.generationId,
      this.options.facts.admission(),
      (pendingReceipt) => this.publishToReceipt(pendingReceipt),
    );
  }

  private async publishToReceipt(receipt: AuthorityReceipt): Promise<WriteResult> {
    try {
      await this.publish(this.options.facts.snapshot());
      return frontierCovers(this.generationIdentity.frontier, receipt.committedFrontier)
        ? publishedResult(receipt, this.generationIdentity.generationId)
        : pendingResult(
            receipt,
            this.generationIdentity.generationId,
            "projection has not reached the committed frontier",
          );
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      this.projectionFailure = failure;
      this.emit("projection-failed", receipt.committedFrontier, null, []);
      return pendingResult(receipt, this.generationIdentity.generationId, failure);
    }
  }

  private async publish(snapshot: ReturnType<FactStore["snapshot"]>): Promise<void> {
    const acknowledgedGenerationId = this.generationIdentity.generationId;
    await this.generations.withReadLease(acknowledgedGenerationId, async () => {
      const previous = await this.currentGeneration();
      const next = await buildAndPublishGeneration(
        this.options,
        this.generations,
        this.publishedSnapshot,
        snapshot,
        previous,
      );
      const recovered = this.projectionFailure !== null;
      this.generationIdentity = next.generation.identity;
      this.publishedSnapshot = snapshot;
      this.projectionFailure = null;
      this.emit(
        recovered ? "projection-recovered" : "projection-published",
        snapshot.frontier,
        next.generation.identity.generationId,
        next.stats.evaluatedOwners,
      );
    });
  }

  private async currentGeneration(): Promise<ProjectionGeneration> {
    return freezePublishedGeneration(
      await this.generations.load(this.generationIdentity.generationId),
    );
  }

  private rejected(code: Parameters<typeof rejectedResult>[0], message: string): RejectedResult {
    return rejectedResult(code, message, this.generationIdentity.generationId);
  }

  private emit(
    kind: EngineEvent["kind"],
    frontier: EngineEvent["frontier"],
    generationId: string | null,
    affectedOwnerIds: readonly string[],
  ): void {
    emitWorkspaceEvent(
      this.listeners,
      this.options.workspaceId,
      kind,
      frontier,
      generationId,
      affectedOwnerIds,
    );
  }

  private noteAuthorityFault(message: string): void {
    const transitioned = this.authorityFault === null;
    this.authorityFault = message;
    if (transitioned) {
      this.emit(
        "projection-failed",
        this.generationIdentity.frontier,
        this.generationIdentity.generationId,
        [],
      );
    }
  }
}
