import {
  parseAuthorityRecords,
  type AuthorityReceipt,
  type FactFrontier,
} from "../domain/fact/index.js";
import type { HistoryQuery } from "../domain/history/index.js";
import type { ReviewQuery } from "../domain/review/index.js";
import type {
  EngineError,
  EngineEvent,
  EngineQueryResult,
  EngineQueryValue,
  WriteResult,
} from "./contract.js";
import { parseProjectionPage } from "./projection-page-validation.js";
import { parseTextAtomId } from "./decision-effect-validation.js";
import {
  parseHistorySelectionContract,
  parseReviewSelectionContract,
} from "./selection-validation.js";

export function parseWriteResult(value: unknown): WriteResult {
  const result = object(value, "write result");
  const status = string(result.status, "write status");
  if (status === "published") {
    exact(result, ["status", "receipt", "generationId"], "published result");
    return {
      status,
      receipt: receipt(result.receipt),
      generationId: string(result.generationId, "generation"),
    };
  }
  if (status === "committed-projection-pending") {
    exact(result, ["status", "receipt", "publishedGenerationId", "failure"], "pending result");
    return {
      status,
      receipt: receipt(result.receipt),
      publishedGenerationId: nullableString(result.publishedGenerationId, "published generation"),
      failure: string(result.failure, "publication failure"),
    };
  }
  if (status === "rejected") {
    exact(result, ["status", "error"], "rejected result");
    return { status, error: engineError(result.error) };
  }
  if (status === "outcome-unknown") {
    exact(result, ["status", "invocationId"], "unknown result");
    return { status, invocationId: string(result.invocationId, "Invocation identity") };
  }
  throw new Error(`Unknown write result status: ${status}`);
}

export function parseEngineQueryResult(value: unknown): EngineQueryResult {
  const result = object(value, "query result");
  const status = string(result.status, "query status");
  if (status === "rejected") {
    exact(result, ["status", "error"], "rejected query result");
    return { status, error: engineError(result.error) };
  }
  if (status !== "ok") {
    throw new Error(`Unknown query result status: ${status}`);
  }
  exact(result, ["status", "value"], "successful query result");
  return { status, value: queryValue(result.value) };
}

export function parseEngineEvent(value: unknown): EngineEvent {
  const event = object(value, "Engine event");
  exact(
    event,
    ["kind", "workspaceId", "frontier", "generationId", "affectedOwnerIds"],
    "Engine event",
  );
  const kind = oneOf(
    event.kind,
    [
      "authority-advanced",
      "projection-published",
      "projection-failed",
      "projection-recovered",
    ] as const,
    "event kind",
  );
  return {
    kind,
    workspaceId: string(event.workspaceId, "Workspace identity"),
    frontier: frontier(event.frontier),
    generationId: nullableString(event.generationId, "generation identity"),
    affectedOwnerIds: strings(event.affectedOwnerIds, "affected owners"),
  };
}

function queryValue(value: unknown): EngineQueryValue {
  const candidate = object(value, "query value");
  if ((candidate.view === "origin" || candidate.view === "review") && "section" in candidate) {
    return parseProjectionPage(candidate);
  }
  if ("hunks" in candidate) {
    return reviewQuery(candidate);
  }
  if ("channelId" in candidate) {
    return historyQuery(candidate);
  }
  return invocationOutcome(candidate);
}

function invocationOutcome(
  value: Record<string, unknown>,
): Extract<EngineQueryValue, { status: string }> {
  if (value.status === "absent") {
    exact(value, ["status"], "absent Invocation outcome");
    return { status: "absent" };
  }
  const parsed = parseWriteResult(value);
  if (parsed.status === "rejected" || parsed.status === "outcome-unknown") {
    throw new Error("Invocation query cannot return a non-durable write result");
  }
  return parsed;
}

function reviewQuery(value: Record<string, unknown>): ReviewQuery {
  exact(value, ["generationId", "frontier", "hunks", "next"], "Review query");
  return {
    generationId: string(value.generationId, "Review generation"),
    frontier: frontier(value.frontier),
    hunks: array(value.hunks, "Review Hunks", (item) => {
      const hunk = object(item, "Review Hunk");
      exact(
        hunk,
        [
          "id",
          "diffSpace",
          "proposalContributionIds",
          "neutralBridgeAtomIds",
          "linkedHunkIds",
          "selection",
        ],
        "Review Hunk",
      );
      const diffSpace = object(hunk.diffSpace, "Diff Space");
      exact(diffSpace, ["kind", "identity"], "Diff Space");
      return {
        id: string(hunk.id, "Hunk identity"),
        diffSpace: {
          kind: oneOf(
            diffSpace.kind,
            ["node-content", "child-sequence", "value", "lifecycle", "canonical"] as const,
            "Diff Space kind",
          ),
          identity: string(diffSpace.identity, "Diff Space identity"),
        },
        proposalContributionIds: strings(hunk.proposalContributionIds, "Hunk proposals"),
        neutralBridgeAtomIds: array(
          hunk.neutralBridgeAtomIds,
          "neutral bridge atoms",
          parseTextAtomId,
        ),
        linkedHunkIds: strings(hunk.linkedHunkIds, "linked Hunks"),
        selection: parseReviewSelectionContract(hunk.selection),
      };
    }),
    next: nullableString(value.next, "Review cursor"),
  };
}

function historyQuery(value: Record<string, unknown>): HistoryQuery {
  exact(value, ["channelId", "undo", "redo"], "History query");
  return {
    channelId: string(value.channelId, "History channel"),
    undo: value.undo === null ? null : parseHistorySelectionContract(value.undo, "undo"),
    redo: value.redo === null ? null : parseHistorySelectionContract(value.redo, "redo"),
  };
}

function receipt(value: unknown): AuthorityReceipt {
  const parsed = parseAuthorityRecords([{ recordKind: "receipt", receipt: value }]);
  const record = parsed[0];
  if (!record || record.recordKind !== "receipt") {
    throw new Error("Invalid authority receipt");
  }
  return record.receipt;
}

function engineError(value: unknown): EngineError {
  const error = object(value, "Engine error");
  exact(error, ["code", "message", "currentGenerationId"], "Engine error");
  return {
    code: oneOf(
      error.code,
      [
        "invalid-input",
        "stale-selection",
        "projection-unavailable",
        "invocation-conflict",
        "authority-fault",
        "history-unavailable",
      ] as const,
      "Engine error code",
    ),
    message: string(error.message, "Engine error message"),
    currentGenerationId: nullableString(error.currentGenerationId, "current generation"),
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

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new Error(`${label} has unknown or missing fields`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
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
