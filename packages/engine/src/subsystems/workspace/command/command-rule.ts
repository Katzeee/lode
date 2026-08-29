import type { RejectedResult } from "@lode/sdk";
import type { AuthorityReceipt, FactActionId, FactId, FactSnapshot, FactBody } from "../../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";

export type WorkspaceCommandReadPlan =
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
    }>
  | RejectedResult;

export type WorkspaceCommandPlanningContext = Readonly<{
  workspaceId: string;
  snapshot: FactSnapshot;
  generation: ProjectionGeneration;
  replicaId: FactAuthorityPort["replicaId"];
}>;

export type BoundWorkspaceCommand = Readonly<{
  readPlan: WorkspaceCommandReadPlan;
  plan(context: WorkspaceCommandPlanningContext): WorkspaceCommandPlan;
}>;
