import type { RejectedResult } from "@lode/sdk";
import type { AcceptedEngineCommand } from "../application/input-validation.js";
import type { AuthorityReceipt, FactSnapshot, FactBody } from "../../../domain/fact/index.js";
import { sameHardDeleteSelection } from "../../../domain/maintenance/index.js";
import type { ScopedProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";
import { assessWorkspaceHardDelete } from "../hard-delete.js";
import { rejectedResult } from "../workspace-results.js";
import type { BoundWorkspaceCommand } from "./command-rule.js";

type MaintenancePlan =
  | Readonly<{
      writes: readonly FactBody[];
      lineage: AuthorityReceipt["lineage"];
      inverse: AuthorityReceipt["inverse"];
    }>
  | RejectedResult;
type MaintenanceCommand = Extract<
  AcceptedEngineCommand,
  { kind: "acknowledge-deletion" | "retire-replica" | "hard-delete" }
>;
type MaintenanceAuthority = Pick<FactAuthorityPort, "replicaId">;

export function bindMaintenanceCommand(command: MaintenanceCommand): BoundWorkspaceCommand {
  const nodeId =
    command.kind === "hard-delete"
      ? command.selection.nodeId
      : command.kind === "acknowledge-deletion"
        ? command.nodeId
        : null;
  const actions = nodeId ? [{ kind: "node-delete" as const, nodeId }] : [];
  return {
    readPlan: { kind: "edits", actions, historyChannelId: null },
    plan({ workspaceId, snapshot, generation, maintenanceAuthority }) {
      return planMaintenanceCommand(workspaceId, command, snapshot, generation, maintenanceAuthority);
    },
  };
}

function planMaintenanceCommand(
  workspaceId: string,
  command: MaintenanceCommand,
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
  authority: MaintenanceAuthority,
): MaintenancePlan {
  if (command.kind === "acknowledge-deletion") {
    const assessment = assessWorkspaceHardDelete(workspaceId, command.nodeId, snapshot, authority, generation.origin);
    if (
      assessment.selection.deletionActionIds.length === 0 ||
      JSON.stringify(command.deletionActionIds) !== JSON.stringify(assessment.selection.deletionActionIds)
    ) {
      return blocked("Deletion acknowledgement does not match the current Trash placement", generation);
    }
    return {
      writes: [
        {
          kind: "maintenance",
          actorId: command.actorId,
          action: {
            kind: "deletion-acknowledge",
            nodeId: command.nodeId,
          },
        },
      ],
      lineage: null,
      inverse: [],
    };
  }
  if (command.kind === "retire-replica") {
    return command.replicaId === authority.replicaId || !Object.hasOwn(snapshot.frontier, command.replicaId)
      ? blocked("Only another known Replica can be retired", generation)
      : {
          writes: [
            {
              kind: "maintenance",
              actorId: command.actorId,
              action: { kind: "replica-retire", replicaId: command.replicaId },
            },
          ],
          lineage: null,
          inverse: [],
        };
  }
  if (command.kind !== "hard-delete") {
    throw new Error("Unknown Maintenance command");
  }
  const assessment = assessWorkspaceHardDelete(
    workspaceId,
    command.selection.nodeId,
    snapshot,
    authority,
    generation.origin,
  );
  if (!assessment.canExecute || !sameHardDeleteSelection(command.selection, assessment.selection)) {
    return blocked(
      `Hard Delete is blocked or stale: ${assessment.blockers.join(", ") || "selection changed"}`,
      generation,
    );
  }
  return {
    writes: [
      {
        kind: "maintenance",
        actorId: command.actorId,
        action: {
          kind: "node-purge",
          nodeId: command.selection.nodeId,
        },
      },
    ],
    lineage: null,
    inverse: [],
  };
}

function blocked(message: string, generation: ScopedProjectionGeneration): RejectedResult {
  return rejectedResult("maintenance-blocked", message, generation.identity.generationId);
}
