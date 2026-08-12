import { parseMutation, type FactFrontier } from "../domain/fact/index.js";
import type { HistorySelection } from "../domain/history/index.js";
import type { ReviewSelection } from "../domain/review/index.js";
import { parseDecisionEffect } from "./decision-effect-validation.js";

export function parseReviewSelectionContract(value: unknown): ReviewSelection {
  const selection = object(value, "Review selection");
  exact(
    selection,
    ["token", "workspaceId", "frontier", "generationId", "evidence"],
    "Review selection",
  );
  const evidence = object(selection.evidence, "Decision evidence");
  exact(
    evidence,
    [
      "proposalTargets",
      "supportClosure",
      "effects",
      "associatedImpactIds",
      "rulesVersion",
      "schemaVersion",
    ],
    "Decision evidence",
  );
  const parsed = {
    token: nonempty(selection.token, "selection token"),
    workspaceId: nonempty(selection.workspaceId, "selection Workspace"),
    frontier: frontier(selection.frontier),
    generationId: nonempty(selection.generationId, "selection generation"),
    evidence: {
      proposalTargets: strings(evidence.proposalTargets, "Proposal targets"),
      supportClosure: strings(evidence.supportClosure, "Support closure"),
      effects: array(evidence.effects, "Decision effects", parseDecisionEffect),
      associatedImpactIds: strings(evidence.associatedImpactIds, "associated impacts"),
      rulesVersion: nonempty(evidence.rulesVersion, "rules version"),
      schemaVersion: nonempty(evidence.schemaVersion, "schema version"),
    },
  };
  return parsed as unknown as ReviewSelection;
}

export function parseHistorySelectionContract(
  value: unknown,
  expectedOperation?: "undo" | "redo",
): HistorySelection {
  const selection = object(value, "History selection");
  exact(
    selection,
    [
      "token",
      "channelId",
      "operation",
      "targetInvocationId",
      "headInvocationId",
      "headOrdinal",
      "frontier",
      "evidence",
    ],
    "History selection",
  );
  const operation = oneOf(selection.operation, ["undo", "redo"] as const, "History operation");
  if (expectedOperation && operation !== expectedOperation) {
    throw new Error("History selection operation does not match command");
  }
  const evidence = object(selection.evidence, "History evidence");
  exact(evidence, ["targetInvocationId", "targetFactIds", "compensations"], "History evidence");
  const targetInvocationId = nonempty(selection.targetInvocationId, "History target Invocation");
  const evidenceTarget = nonempty(evidence.targetInvocationId, "History evidence target");
  if (targetInvocationId !== evidenceTarget) {
    throw new Error("History selection and evidence target different Invocations");
  }
  const parsed = {
    token: nonempty(selection.token, "History token"),
    channelId: nonempty(selection.channelId, "History channel"),
    operation,
    targetInvocationId,
    headInvocationId: nullableString(selection.headInvocationId, "History head"),
    headOrdinal: safeInteger(selection.headOrdinal, 0, "History head ordinal"),
    frontier: frontier(selection.frontier),
    evidence: {
      targetInvocationId: evidenceTarget,
      targetFactIds: strings(evidence.targetFactIds, "History target Facts"),
      compensations: array(evidence.compensations, "History compensations", parseMutation),
    },
  };
  return parsed as unknown as HistorySelection;
}

function frontier(value: unknown): FactFrontier {
  const candidate = object(value, "Fact frontier");
  for (const [replicaId, sequence] of Object.entries(candidate)) {
    if (!/^[a-z2-7]{26}$/.test(replicaId)) {
      throw new Error("Invalid frontier Replica identity");
    }
    safeInteger(sequence, 0, "frontier sequence");
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
  return array(value, label, (item) => nonempty(item, label));
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new Error(`${label} has unknown or missing fields`);
  }
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : nonempty(value, label);
}

function safeInteger(value: unknown, minimum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
