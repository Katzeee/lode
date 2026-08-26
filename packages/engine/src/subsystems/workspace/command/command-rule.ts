import type { RejectedResult } from "@lode/sdk";
import type { EditAction } from "../../../domain/edit/index.js";
import type {
  AuthorityReceipt,
  FactActionId,
  FactId,
  FactSnapshot,
  FactBody,
  HistoryChannelId,
} from "../../../domain/fact/index.js";
import type { ScopedProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";

export type WorkspaceCommandReadPlan =
  | Readonly<{
      kind: "edits";
      actions: readonly EditAction[];
      historyChannelId: HistoryChannelId | null;
    }>
  | Readonly<{
      kind: "facts";
      factIds: readonly FactId[];
      historyChannelId: HistoryChannelId | null;
    }>
  | Readonly<{
      kind: "action-ids";
      actionIds: readonly FactActionId[];
      historyChannelId: HistoryChannelId | null;
    }>
  | Readonly<{
      kind: "history";
      historyChannelId: HistoryChannelId;
    }>
  | Readonly<{
      kind: "projection-scope";
      nodeIds: readonly string[];
      readsOwnerGraph: boolean;
      readsOwnedDescendants: boolean;
      historyChannelId: null;
    }>;

type WorkspaceCommandPlan =
  | Readonly<{
      writes: readonly FactBody[];
      lineage: AuthorityReceipt["lineage"];
    }>
  | RejectedResult;

export type WorkspaceCommandPlanningContext = Readonly<{
  workspaceId: string;
  snapshot: FactSnapshot;
  generation: ScopedProjectionGeneration;
  receipts: readonly AuthorityReceipt[];
  replicaId: FactAuthorityPort["replicaId"];
}>;

export type BoundWorkspaceCommand = Readonly<{
  readPlan: WorkspaceCommandReadPlan;
  plan(context: WorkspaceCommandPlanningContext): WorkspaceCommandPlan;
}>;
