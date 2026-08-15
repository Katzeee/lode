import type { RejectedResult } from "@lode/sdk";
import type { EditMutation } from "../../../domain/edit/index.js";
import type { AuthorityReceipt, FactSnapshot, FactWrite, HistoryChannelId } from "../../../domain/fact/index.js";
import type { ScopedProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { FactAuthority } from "../../authority/fact-authority.js";

export type WorkspaceCommandReadPlan =
  | Readonly<{
      kind: "mutations";
      mutations: readonly EditMutation[];
      historyChannelId: HistoryChannelId | null;
    }>
  | Readonly<{
      kind: "facts";
      factIds: readonly string[];
      historyChannelId: HistoryChannelId | null;
    }>;

export type WorkspaceCommandPlan =
  | Readonly<{
      writes: readonly FactWrite[];
      lineage: AuthorityReceipt["lineage"];
    }>
  | RejectedResult;

export type WorkspaceCommandPlanningContext = Readonly<{
  workspaceId: string;
  snapshot: FactSnapshot;
  generation: ScopedProjectionGeneration;
  receipts: readonly AuthorityReceipt[];
  maintenanceAuthority: Pick<FactAuthority, "replicaId" | "uncertainInvocations">;
  reviewCapabilityKey?: string;
}>;

export type BoundWorkspaceCommand = Readonly<{
  readPlan: WorkspaceCommandReadPlan;
  plan(context: WorkspaceCommandPlanningContext): WorkspaceCommandPlan;
}>;
