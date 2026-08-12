import type { EngineCommand, EngineQuery, HardDeleteSelection } from "./contract.js";

export function parseMaintenanceCommand(
  kind: string,
  command: Record<string, unknown>,
): EngineCommand | null {
  if (kind === "acknowledge-deletion") {
    exact(command, ["kind", "workspaceId", "invocationId", "actorId", "nodeId", "deletionFactIds"]);
    return {
      kind,
      workspaceId: nonempty(command.workspaceId, "Workspace identity"),
      invocationId: nonempty(command.invocationId, "Invocation identity"),
      actorId: nonempty(command.actorId, "Actor identity"),
      nodeId: nonempty(command.nodeId, "deleted Node identity"),
      deletionFactIds: identities(command.deletionFactIds, "deletion Fact identities"),
    };
  }
  if (kind === "retire-replica") {
    exact(command, ["kind", "workspaceId", "invocationId", "actorId", "replicaId"]);
    return {
      kind,
      workspaceId: nonempty(command.workspaceId, "Workspace identity"),
      invocationId: nonempty(command.invocationId, "Invocation identity"),
      actorId: nonempty(command.actorId, "Actor identity"),
      replicaId: replicaId(command.replicaId, "retired Replica identity"),
    };
  }
  if (kind !== "hard-delete") {
    return null;
  }
  exact(command, ["kind", "workspaceId", "invocationId", "actorId", "selection"]);
  return {
    kind,
    workspaceId: nonempty(command.workspaceId, "Workspace identity"),
    invocationId: nonempty(command.invocationId, "Invocation identity"),
    actorId: nonempty(command.actorId, "Actor identity"),
    selection: hardDeleteSelection(command.selection),
  };
}

export function parseMaintenanceQuery(
  kind: string,
  query: Record<string, unknown>,
): EngineQuery | null {
  if (kind !== "hard-delete-preview") {
    return null;
  }
  exact(query, ["kind", "workspaceId", "nodeId"]);
  return {
    kind,
    workspaceId: nonempty(query.workspaceId, "Workspace identity"),
    nodeId: nonempty(query.nodeId, "hard-delete Node identity"),
  };
}

function hardDeleteSelection(value: unknown): HardDeleteSelection {
  const selection = object(value, "Hard Delete selection");
  exact(selection, [
    "workspaceId",
    "frontier",
    "nodeId",
    "deletionFactIds",
    "acknowledgementFactIds",
    "retiredReplicaIds",
  ]);
  return {
    workspaceId: nonempty(selection.workspaceId, "Workspace identity"),
    frontier: factFrontier(selection.frontier),
    nodeId: nonempty(selection.nodeId, "hard-delete Node identity"),
    deletionFactIds: identities(selection.deletionFactIds, "deletion Fact identities"),
    acknowledgementFactIds: identities(
      selection.acknowledgementFactIds,
      "acknowledgement Fact identities",
    ),
    retiredReplicaIds: identityArray(selection.retiredReplicaIds, "retired Replica identities"),
  };
}

function factFrontier(value: unknown): Readonly<Record<string, number>> {
  const frontier = object(value, "Fact frontier");
  for (const [id, sequence] of Object.entries(frontier)) {
    replicaId(id, "Frontier Replica identity");
    if (!Number.isSafeInteger(sequence) || (sequence as number) < 0) {
      throw new Error("Fact frontier sequence is invalid");
    }
  }
  return frontier as Readonly<Record<string, number>>;
}

function identities(value: unknown, label: string): readonly string[] {
  const result = identityArray(value, label);
  if (result.length === 0) {
    throw new Error(`${label} must be non-empty`);
  }
  return result;
}

function identityArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an identity array`);
  }
  const result = value.map((item) => nonempty(item, label));
  if (new Set(result).size !== result.length) {
    throw new Error(`${label} contains duplicate identities`);
  }
  return result;
}

function replicaId(value: unknown, label: string): string {
  const identity = nonempty(value, label);
  if (!/^[a-z2-7]{26}$/.test(identity)) {
    throw new Error(`${label} is invalid`);
  }
  return identity;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== allowed.length || actual.some((key) => !allowed.includes(key))) {
    throw new Error("Maintenance input has unknown or missing fields");
  }
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
