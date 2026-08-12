import type { FactFrontier } from "../domain/fact/index.js";
import type { HardDeletePreview, HardDeleteSelection } from "./contract.js";

export function parseHardDeletePreview(value: Record<string, unknown>): HardDeletePreview {
  exact(value, [
    "generationId",
    "selection",
    "referenceOccurrenceIds",
    "schemaApplicationNodeIds",
    "materializedFieldNodeIds",
    "pendingProposalContributionIds",
    "knownReplicaIds",
    "acknowledgedReplicaIds",
    "outcomeUnknownInvocationIds",
    "historyImpact",
    "blockers",
    "canExecute",
  ]);
  const blockers = array(value.blockers, "Hard Delete blockers", (blocker) => {
    if (
      blocker !== "already-purged" &&
      blocker !== "not-tombstoned" &&
      blocker !== "pending-proposal" &&
      blocker !== "replica-unconfirmed" &&
      blocker !== "outcome-unknown"
    ) {
      throw new Error("Hard Delete blocker is invalid");
    }
    return blocker;
  });
  return {
    generationId: string(value.generationId, "Hard Delete generation"),
    selection: selection(value.selection),
    referenceOccurrenceIds: strings(value.referenceOccurrenceIds, "Reference Occurrences"),
    schemaApplicationNodeIds: strings(value.schemaApplicationNodeIds, "Schema Applications"),
    materializedFieldNodeIds: strings(value.materializedFieldNodeIds, "Materialized Fields"),
    pendingProposalContributionIds: strings(value.pendingProposalContributionIds, "Proposals"),
    knownReplicaIds: strings(value.knownReplicaIds, "known Replicas"),
    acknowledgedReplicaIds: strings(value.acknowledgedReplicaIds, "acknowledged Replicas"),
    outcomeUnknownInvocationIds: strings(value.outcomeUnknownInvocationIds, "unknown Invocations"),
    historyImpact: parseHistoryImpact(value.historyImpact),
    blockers,
    canExecute: boolean(value.canExecute, "Hard Delete availability"),
  };
}

function parseHistoryImpact(value: unknown): HardDeletePreview["historyImpact"] {
  const impact = object(value, "Hard Delete History impact");
  exact(impact, [
    "affectedInvocationIds",
    "affectedChannelIds",
    "totalAffectedInvocations",
    "truncated",
  ]);
  const affectedInvocationIds = strings(impact.affectedInvocationIds, "History Invocations");
  const affectedChannelIds = strings(impact.affectedChannelIds, "History channels");
  if (
    affectedInvocationIds.length > 50 ||
    affectedChannelIds.length > 50 ||
    !Number.isSafeInteger(impact.totalAffectedInvocations) ||
    (impact.totalAffectedInvocations as number) < affectedInvocationIds.length
  ) {
    throw new Error("Hard Delete History impact is invalid");
  }
  return {
    affectedInvocationIds,
    affectedChannelIds,
    totalAffectedInvocations: impact.totalAffectedInvocations as number,
    truncated: boolean(impact.truncated, "History impact truncation"),
  };
}

function selection(value: unknown): HardDeleteSelection {
  const candidate = object(value, "Hard Delete selection");
  exact(candidate, [
    "workspaceId",
    "frontier",
    "nodeId",
    "deletionFactIds",
    "acknowledgementFactIds",
    "retiredReplicaIds",
  ]);
  return {
    workspaceId: string(candidate.workspaceId, "Workspace identity"),
    frontier: frontier(candidate.frontier),
    nodeId: string(candidate.nodeId, "Hard Delete Node identity"),
    deletionFactIds: strings(candidate.deletionFactIds, "deletion Facts"),
    acknowledgementFactIds: strings(candidate.acknowledgementFactIds, "acknowledgement Facts"),
    retiredReplicaIds: strings(candidate.retiredReplicaIds, "retired Replicas"),
  };
}

function frontier(value: unknown): FactFrontier {
  const candidate = object(value, "Fact frontier");
  for (const [replicaId, sequence] of Object.entries(candidate)) {
    if (
      !/^[a-z2-7]{26}$/.test(replicaId) ||
      !Number.isSafeInteger(sequence) ||
      (sequence as number) < 0
    ) {
      throw new Error("Invalid Fact frontier");
    }
  }
  return candidate as FactFrontier;
}

function array<T>(value: unknown, label: string, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map(parse);
}

function strings(value: unknown, label: string): string[] {
  return array(value, label, (item) => string(item, label));
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new Error("Hard Delete output has unknown or missing fields");
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
