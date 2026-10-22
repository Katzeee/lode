import type { RejectedResult } from "@lode/sdk";
import type {
  AuthorityReceipt,
  FactActionId,
  FactId,
  FactSnapshot,
  FactBody,
  HistoryRestoration,
} from "../../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";

type WorkspaceCommandFactReadPlan =
  | Readonly<{
      kind: "all";
    }>
  | Readonly<{
      kind: "facts";
      factIds: readonly FactId[];
    }>
  | Readonly<{
      kind: "action-ids";
      actionIds: readonly FactActionId[];
    }>;

type WorkspaceCommandPlan =
  | Readonly<{
      writes: readonly FactBody[];
      lineage: AuthorityReceipt["lineage"];
      restorations?: readonly HistoryRestoration[];
    }>
  | RejectedResult;

export type WorkspaceCommandPlanningContext = Readonly<{
  workspaceId: string;
  snapshot: FactSnapshot;
  generation: ProjectionGeneration;
  replicaId: FactAuthorityPort["replicaId"];
}>;

export type BoundWorkspaceCommand = Readonly<{
  factReadPlan: WorkspaceCommandFactReadPlan;
  plan(context: WorkspaceCommandPlanningContext): WorkspaceCommandPlan;
}>;
