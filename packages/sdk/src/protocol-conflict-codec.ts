import { ConflictIssueSchema } from "@lode/protocol/proto";

import type { ConflictIssue } from "./review.js";
import { conflictIssueKind, protocolConflictIssueCase, type ProtocolConflictIssueCase } from "./protocol-cases.js";
import { selectedCase } from "./protocol-decoding.js";
import { fromProtocolMessage, toProtocolMessage } from "./protocol-message-codec.js";
import { fromProtocolValue, toProtocolValue } from "./protocol-value-codec.js";

export function toConflictIssue(issue: ConflictIssue): Record<string, unknown> {
  const value = toProtocolValue(issue) as Record<string, unknown>;
  delete value.kind;
  const wrapped = { issue: { case: protocolConflictIssueCase(issue.kind), value } };
  return toProtocolMessage(ConflictIssueSchema, wrapped) as Record<string, unknown>;
}

export function fromConflictIssue(value: unknown): ConflictIssue {
  const decodedMessage = fromProtocolMessage(ConflictIssueSchema, value) as Record<string, unknown>;
  const selected = selectedCase(
    (
      decodedMessage as {
        issue?: { case: ProtocolConflictIssueCase; value: unknown } | { case: undefined } | null;
      }
    ).issue,
    "Conflict issue",
  );
  const decoded = fromProtocolValue(selected.value) as Record<string, unknown>;
  return { ...decoded, kind: conflictIssueKind(selected.case) } as ConflictIssue;
}

export function toConflictQueryResult(value: unknown): Record<string, unknown> {
  const result = value as { issues: readonly ConflictIssue[] };
  return {
    ...(toProtocolValue(value) as Record<string, unknown>),
    issues: result.issues.map(toConflictIssue),
  };
}

export function fromConflictQueryResult(value: unknown): Record<string, unknown> {
  const result = fromProtocolValue(value) as Record<string, unknown>;
  result.issues = (result.issues as readonly unknown[]).map(fromConflictIssue);
  return result;
}
