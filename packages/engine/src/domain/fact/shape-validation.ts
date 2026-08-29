import { type FactBody, type AuthoredAction } from "./types.js";
import type { AuthorityReceipt } from "./authority-types.js";
import { isCatalogActionKind, parseCatalogAction } from "./action-catalog.js";
import { assertFactBody } from "./fact-body-shape-validation.js";
import { requireFactId, requireFactIds } from "./identities.js";
import { assertKeys, assertObject, assertOneOf, requireSafeInteger, requireString } from "../../decoding/index.js";

export function parseFactBody(value: unknown): FactBody {
  assertFactBody(value, parseCatalogAction);
  return value;
}

export function parseAuthorityReceipt(value: unknown): AuthorityReceipt {
  assertReceipt(value);
  return value;
}

function assertReceipt(value: unknown): asserts value is AuthorityReceipt {
  assertObject(value, "receipt");
  assertKeys(
    value,
    ["workspaceId", "replicaId", "invocationId", "requestDigest", "factIds", "committedFrontier", "lineage"],
    "receipt",
  );
  requireString(value.workspaceId, "receipt Workspace identity");
  requireString(value.replicaId, "receipt Replica identity");
  requireString(value.invocationId, "receipt Invocation identity");
  requireString(value.requestDigest, "receipt request digest");
  requireFactIds(value.factIds, "receipt Fact identities");
  assertFrontier(value.committedFrontier, "receipt committed frontier");
  if (value.lineage === null) {
    return;
  }
  assertObject(value.lineage, "receipt lineage");
  assertKeys(value.lineage, ["channelId", "operation", "targetStepId"], "receipt lineage");
  requireString(value.lineage.channelId, "History channel identity");
  assertOneOf(value.lineage.operation, ["normal", "undo", "redo"], "History operation");
  if (value.lineage.targetStepId !== null) {
    requireFactId(value.lineage.targetStepId, "History target Step");
  }
}

export function parseAuthoredAction<Kind extends AuthoredAction["kind"]>(
  value: Readonly<{ kind: Kind }> & Record<string, unknown>,
): Extract<AuthoredAction, { kind: Kind }>;
export function parseAuthoredAction(value: unknown): AuthoredAction;
export function parseAuthoredAction(value: unknown): AuthoredAction {
  return parseCatalogAction(value);
}

export function isAuthoredActionKind(value: unknown): value is AuthoredAction["kind"] {
  return isCatalogActionKind(value);
}

function assertFrontier(value: unknown, label: string): void {
  assertObject(value, label);
  for (const [replicaId, sequence] of Object.entries(value)) {
    requireString(replicaId, `${label} Replica identity`);
    requireSafeInteger(sequence, 0, `${label} sequence`);
  }
}
