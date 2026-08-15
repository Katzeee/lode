import type { RejectedResult, WriteResult } from "@lode/sdk";
import type { AcceptedEngineCommand } from "../../../application/input-validation.js";
import {
  frontierCovers,
  frontierEquals,
  requestDigest,
  type AuthorityReceipt,
  type FactSnapshot,
} from "../../../domain/fact/index.js";
import { AuthorityFaultError } from "../../authority/errors.js";
import type { FactAuthority } from "../../authority/fact-authority.js";
import type { WorkspaceProjectionLifecycle } from "../projection-lifecycle/index.js";
import {
  executionErrorResult,
  finishWorkspaceReceipt,
  pendingResult,
  publishedResult,
  rejectedResult,
} from "../workspace-results.js";
import type { WorkspaceSignals } from "../workspace-signals.js";
import { bindWorkspaceCommand } from "./command-rules.js";
import { readCommandGeneration } from "./generation-reader.js";

type WorkspaceCommandExecutorOptions = Readonly<{
  workspaceId: string;
  facts: WorkspaceCommandAuthority;
  projection: WorkspaceProjectionLifecycle;
  signals: WorkspaceSignals;
  reviewCapabilityKey?: string;
}>;

type WorkspaceCommandAuthority = Pick<
  FactAuthority,
  | "admission"
  | "commit"
  | "receipt"
  | "receiptsForChannel"
  | "relatedFacts"
  | "replicaId"
  | "snapshot"
  | "uncertainInvocations"
>;

export class WorkspaceCommandExecutor {
  constructor(private readonly options: WorkspaceCommandExecutorOptions) {}

  async execute(command: AcceptedEngineCommand): Promise<WriteResult> {
    try {
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
        this.options.signals.recordAuthorityFault(fault, this.options.projection.identity);
        throw new AuthorityFaultError(fault);
      }
      this.options.signals.clearAuthorityFault();
      if (!frontierEquals(this.options.projection.identity.frontier, admission.snapshot.frontier)) {
        return this.rejected(
          "projection-unavailable",
          "Projection Generation does not cover the admitted authority frontier",
        );
      }
      const bound = bindWorkspaceCommand(command);
      const { readPlan } = bound;
      const scopedFacts =
        readPlan.kind === "facts" ? this.options.facts.relatedFacts(readPlan.factIds) : admission.snapshot.facts;
      const commandSnapshot = { facts: scopedFacts, frontier: admission.snapshot.frontier };
      const generation = await readCommandGeneration(
        this.options.projection.projections,
        this.options.projection.identity.generationId,
        commandSnapshot,
        readPlan,
      );
      const planned = bound.plan({
        workspaceId: this.options.workspaceId,
        snapshot: commandSnapshot,
        generation,
        receipts:
          readPlan.historyChannelId === null ? [] : this.options.facts.receiptsForChannel(readPlan.historyChannelId),
        maintenanceAuthority: this.options.facts,
        ...(this.options.reviewCapabilityKey ? { reviewCapabilityKey: this.options.reviewCapabilityKey } : {}),
      });
      if ("status" in planned) {
        return planned;
      }
      const committed = await this.options.facts.commit({
        invocationId: command.invocationId,
        request: command,
        writes: planned.writes,
        lineage: planned.lineage,
        publishedFrontier: this.options.projection.identity.frontier,
      });
      if (committed.created) {
        this.options.signals.emit("authority-advanced", committed.receipt.committedFrontier, null);
      }
      return await this.publishToReceipt(committed.receipt);
    } catch (error) {
      return executionErrorResult(error, this.options.projection.identity.generationId);
    }
  }

  private async finishReceipt(receipt: AuthorityReceipt): Promise<WriteResult> {
    if (frontierCovers(this.options.projection.identity.frontier, receipt.committedFrontier)) {
      return publishedResult(receipt, this.options.projection.identity.generationId);
    }
    return finishWorkspaceReceipt(
      receipt,
      this.options.projection.identity.generationId,
      this.options.facts.admission(),
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
