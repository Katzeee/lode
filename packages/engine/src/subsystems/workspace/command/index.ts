import type { RejectedResult, WriteResult } from "@lode/sdk";
import type { AcceptedEngineCommand } from "../application/input-validation.js";
import {
  frontierCovers,
  frontierEquals,
  requestDigest,
  type AuthorityReceipt,
  type FactSnapshot,
} from "../../../domain/fact/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";
import type { WorkspaceProjection } from "../projection/index.js";
import {
  executionErrorResult,
  finishWorkspaceReceipt,
  pendingResult,
  publishedResult,
  rejectedResult,
} from "../workspace-results.js";
import type { WorkspaceEventPublisher } from "../workspace-event-publisher.js";
import { bindWorkspaceCommand } from "./command-rules.js";
import { readCommandGeneration } from "./generation-reader.js";

type WorkspaceCommandExecutorOptions = Readonly<{
  workspaceId: string;
  facts: WorkspaceCommandAuthority;
  projection: WorkspaceProjection;
  events?: WorkspaceEventPublisher;
  reviewCapabilityKey?: string;
}>;

type WorkspaceCommandAuthority = Pick<
  FactAuthorityPort,
  "snapshot" | "commit" | "receipt" | "receiptsForChannel" | "relatedFacts" | "relatedFactsOwningActions" | "replicaId"
>;

export class WorkspaceCommandExecutor {
  constructor(private readonly options: WorkspaceCommandExecutorOptions) {}

  async execute(command: AcceptedEngineCommand): Promise<WriteResult> {
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
    const snapshot = this.options.facts.snapshot();
    if (!frontierEquals(this.options.projection.identity.frontier, snapshot.frontier)) {
      return this.rejected(
        "projection-unavailable",
        "Projection Generation does not cover the interpreted authority frontier",
      );
    }
    const bound = bindWorkspaceCommand(command);
    const { readPlan } = bound;
    const scopedFacts =
      readPlan.historyChannelId !== null
        ? snapshot.facts
        : readPlan.kind === "facts"
          ? this.options.facts.relatedFacts(readPlan.factIds)
          : readPlan.kind === "action-ids"
            ? this.options.facts.relatedFactsOwningActions(readPlan.actionIds)
            : snapshot.facts;
    const commandSnapshot = { facts: scopedFacts, frontier: snapshot.frontier };
    let generation: Awaited<ReturnType<typeof readCommandGeneration>>;
    try {
      generation = await readCommandGeneration(
        this.options.projection.reader,
        this.options.projection.identity.generationId,
        commandSnapshot,
        readPlan,
      );
    } catch (error) {
      return this.rejected("projection-unavailable", error instanceof Error ? error.message : String(error));
    }
    let planned: ReturnType<typeof bound.plan>;
    try {
      planned = bound.plan({
        workspaceId: this.options.workspaceId,
        snapshot: commandSnapshot,
        generation,
        receipts:
          readPlan.historyChannelId === null ? [] : this.options.facts.receiptsForChannel(readPlan.historyChannelId),
        maintenanceAuthority: this.options.facts,
        ...(this.options.reviewCapabilityKey ? { reviewCapabilityKey: this.options.reviewCapabilityKey } : {}),
      });
    } catch (error) {
      return this.rejected("invalid-input", error instanceof Error ? error.message : String(error));
    }
    if ("status" in planned) {
      return planned;
    }
    if (planned.writes.length === 0) {
      return this.rejected("invalid-input", "Command does not produce any Facts");
    }
    let committed: Awaited<ReturnType<WorkspaceCommandAuthority["commit"]>>;
    try {
      committed = await this.options.facts.commit({
        invocationId: command.invocationId,
        request: command,
        writes: planned.writes,
        lineage: planned.lineage,
        inverse: planned.inverse,
        publishedFrontier: this.options.projection.identity.frontier,
      });
    } catch (error) {
      return executionErrorResult(error, this.options.projection.identity.generationId);
    }
    if (committed.created) {
      this.options.events?.publish("authority-advanced", committed.receipt.committedFrontier, null);
    }
    return this.publishToReceipt(committed.receipt);
  }

  private async finishReceipt(receipt: AuthorityReceipt): Promise<WriteResult> {
    if (frontierCovers(this.options.projection.identity.frontier, receipt.committedFrontier)) {
      return publishedResult(receipt, this.options.projection.identity.generationId);
    }
    return finishWorkspaceReceipt(
      receipt,
      this.options.projection.identity.generationId,
      this.options.facts.snapshot(),
      (pendingReceipt) => this.publishToReceipt(pendingReceipt),
    );
  }

  private async publishToReceipt(receipt: AuthorityReceipt): Promise<WriteResult> {
    try {
      await this.publish(this.options.facts.snapshot());
      return frontierCovers(this.options.projection.identity.frontier, receipt.committedFrontier)
        ? publishedResult(receipt, this.options.projection.identity.generationId)
        : pendingResult(
            receipt,
            this.options.projection.identity.generationId,
            "projection has not reached the committed frontier",
          );
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      return pendingResult(receipt, this.options.projection.identity.generationId, failure);
    }
  }

  private async publish(snapshot: FactSnapshot): Promise<void> {
    await this.options.projection.advance(snapshot);
  }

  private rejected(code: Parameters<typeof rejectedResult>[0], message: string): RejectedResult {
    return rejectedResult(code, message, this.options.projection.identity.generationId);
  }
}
