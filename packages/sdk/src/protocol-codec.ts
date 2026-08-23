import {
  EngineCommand as ProtocolEngineCommand,
  EngineEvent as ProtocolEngineEvent,
  EngineQuery as ProtocolEngineQuery,
  QueryResult as ProtocolQueryResult,
  WriteResult as ProtocolWriteResult,
} from "@lode/protocol/dto/engine";
import {
  EditActionSchema,
  EngineCommandSchema,
  EngineEventSchema,
  EngineQuerySchema,
  QueryResultSchema,
  WriteResultSchema,
} from "@lode/protocol/proto";
import type { EditAction } from "./edit.js";
import type { HistoryQuery } from "./history.js";
import type {
  EngineCommand,
  EngineError,
  EngineEvent,
  EngineQuery,
  EngineQueryResult,
  DebugNodeResult,
  InvocationOutcome,
  ViewRowsResult,
  WriteResult,
} from "./contract.js";
import type { ProjectionPage } from "./projection.js";
import type { ConflictIssue, ReviewQuery } from "./review.js";
import { fromProjectionPage, toProjectionPage } from "./protocol-projection-codec.js";
import {
  commandKind,
  actionKind,
  protocolCommandCase,
  protocolActionCase,
  protocolQueryCase,
  protocolWriteResultCase,
  queryKind,
  writeResultStatus,
  type ProtocolActionCase,
} from "./protocol-cases.js";
import {
  fromInvocationOutcome,
  fromProtocolValue,
  fromReviewQuery,
  fromReviewSelection,
  required,
  toConflictIssue,
  toInvocationOutcome,
  toProtocolValue,
  toReviewQuery,
  toReviewSelection,
} from "./protocol-shape-codec.js";
import { fromProtocolMessage, toProtocolMessage } from "./protocol-message-codec.js";
import {
  fromHistoryQuery,
  fromHistorySelection,
  toHistoryQuery,
  toHistorySelection,
} from "./protocol-history-codec.js";
import { fromDebugNodeResult, toDebugNodeResult } from "./protocol-debug-node-codec.js";
import {
  fromSearchClause,
  fromSearchExpressionDraft,
  toSearchClause,
  toSearchExpressionDraft,
} from "./protocol-search-expression-codec.js";
import { fromViewOptionsSpec, toViewOptionsSpec } from "./protocol-view-options-codec.js";

export function encodeEngineCommand(command: EngineCommand): Uint8Array {
  const value = toProtocolMessage(EngineCommandSchema, { command: commandValue(command) });
  return ProtocolEngineCommand.encode(ProtocolEngineCommand.fromPartial(value as never)).finish();
}

export function decodeEngineCommand(bytes: Uint8Array): EngineCommand {
  const message = fromProtocolMessage(EngineCommandSchema, ProtocolEngineCommand.decode(bytes)) as ReturnType<
    typeof ProtocolEngineCommand.decode
  >;
  const selected = required(message.command, "Engine command");
  const decoded = fromProtocolValue(selected.value) as Record<string, unknown>;
  if (selected.$case === "edit") {
    decoded.actions = selected.value.actions.map(fromEditAction);
  } else if (selected.$case === "resolveReview") {
    decoded.selection = fromReviewSelection(selected.value.selection);
  } else if (selected.$case === "undo" || selected.$case === "redo") {
    decoded.selection = fromHistorySelection(selected.value.selection);
  }
  return { ...decoded, kind: commandKind(selected.$case) } as EngineCommand;
}

export function encodeEngineQuery(query: EngineQuery): Uint8Array {
  const $case = protocolQueryCase(query.kind);
  const message = toProtocolMessage(EngineQuerySchema, {
    query: { $case, value: toProtocolValue(query) },
  });
  return ProtocolEngineQuery.encode(ProtocolEngineQuery.fromPartial(message as never)).finish();
}

export function decodeEngineQuery(bytes: Uint8Array): EngineQuery {
  const message = fromProtocolMessage(EngineQuerySchema, ProtocolEngineQuery.decode(bytes)) as ReturnType<
    typeof ProtocolEngineQuery.decode
  >;
  const selected = required(message.query, "Engine query");
  const value = fromProtocolValue(selected.value) as Record<string, unknown>;
  for (const key of ["section", "after", "limit", "viewDefinitionNodeId"] as const) {
    if (value[key] === null) {
      delete value[key];
    }
  }
  return { ...value, kind: queryKind(selected.$case) } as EngineQuery;
}

export function encodeWriteResult(result: WriteResult): Uint8Array {
  const $case = protocolWriteResultCase(result.status);
  const message = toProtocolMessage(WriteResultSchema, {
    result: { $case, value: toProtocolValue(result) },
  });
  return ProtocolWriteResult.encode(ProtocolWriteResult.fromPartial(message as never)).finish();
}

export function decodeWriteResult(bytes: Uint8Array): WriteResult {
  const message = fromProtocolMessage(WriteResultSchema, ProtocolWriteResult.decode(bytes)) as ReturnType<
    typeof ProtocolWriteResult.decode
  >;
  const selected = required(message.result, "Engine write result");
  return {
    ...(fromProtocolValue(selected.value) as Record<string, unknown>),
    status: writeResultStatus(selected.$case),
  } as WriteResult;
}

export function encodeEngineQueryResult(query: EngineQuery, result: EngineQueryResult): Uint8Array {
  if (result.status === "rejected") {
    return encodeEngineQueryError(result.error);
  }
  const $case = protocolQueryCase(query.kind);
  const message = toProtocolMessage(QueryResultSchema, {
    result: { $case, value: toQueryValue(query, result.value) },
  });
  return ProtocolQueryResult.encode(ProtocolQueryResult.fromPartial(message as never)).finish();
}

export function encodeEngineQueryError(error: EngineError): Uint8Array {
  const message = toProtocolMessage(QueryResultSchema, {
    result: { $case: "rejected", value: error },
  });
  return ProtocolQueryResult.encode(ProtocolQueryResult.fromPartial(message as never)).finish();
}

export function decodeEngineQueryResult<Query extends EngineQuery>(
  bytes: Uint8Array,
  query: Query,
): EngineQueryResult<Query> {
  const message = fromProtocolMessage(QueryResultSchema, ProtocolQueryResult.decode(bytes)) as ReturnType<
    typeof ProtocolQueryResult.decode
  >;
  const selected = required(message.result, "Engine query result");
  if (selected.$case === "rejected") {
    return { status: "rejected", error: fromProtocolValue(selected.value) } as EngineQueryResult<Query>;
  }
  const expected = protocolQueryCase(query.kind);
  if (selected.$case !== expected) {
    throw new Error(`Engine query result ${selected.$case} does not match ${query.kind}`);
  }
  const value =
    selected.$case === "invocation"
      ? fromInvocationOutcome(selected.value)
      : selected.$case === "projection"
        ? fromProjectionPage(selected.value)
        : selected.$case === "review"
          ? fromReviewQuery(selected.value)
          : selected.$case === "history"
            ? fromHistoryQuery(selected.value)
            : selected.$case === "debugNode"
              ? fromDebugNodeResult(selected.value)
              : selected.$case === "viewRows"
                ? fromViewRowsResult(selected.value)
                : fromProtocolValue(selected.value);
  return { status: "ok", value } as EngineQueryResult<Query>;
}

export function encodeEngineEvent(event: EngineEvent): Uint8Array {
  const message = toProtocolMessage(EngineEventSchema, toProtocolValue(event));
  return ProtocolEngineEvent.encode(ProtocolEngineEvent.fromPartial(message as never)).finish();
}

export function decodeEngineEvent(bytes: Uint8Array): EngineEvent {
  const message = fromProtocolMessage(EngineEventSchema, ProtocolEngineEvent.decode(bytes));
  return fromProtocolValue(message) as EngineEvent;
}

function commandValue(
  command: EngineCommand,
): NonNullable<Parameters<typeof ProtocolEngineCommand.fromPartial>[0]["command"]> {
  const value = toProtocolValue(command) as Record<string, unknown>;
  if (command.kind === "edit") {
    value.actions = command.actions.map(toEditAction);
  } else if (command.kind === "resolve-review") {
    value.selection = toReviewSelection(command.selection);
  } else if (command.kind === "undo" || command.kind === "redo") {
    value.selection = toHistorySelection(command.selection);
  }
  return { $case: protocolCommandCase(command.kind), value };
}

function toEditAction(action: EditAction): Record<string, unknown> {
  assertActionFields(action);
  const value = toProtocolValue(action) as Record<string, unknown>;
  if (action.kind === "field-initialization-expression-configure") {
    const { kind: _kind, ...expression } = action.expression;
    value.expression = expression;
  } else if (action.kind === "search-expression-create") {
    value.expression = toSearchExpressionDraft(action.expression);
  } else if (action.kind === "search-expression-configure" || action.kind === "view-filter-expression-configure") {
    value.clause = toSearchClause(action.clause);
  } else if (action.kind === "search-expression-add" || action.kind === "view-filter-expression-add") {
    value.expression = toSearchExpressionDraft(action.expression);
  } else if (action.kind === "view-filter-create") {
    value.expression = toSearchExpressionDraft(action.expression);
  }
  return { action: { $case: protocolActionCase(action.kind), value } };
}

function fromEditAction(value: unknown): EditAction {
  const action = required(
    (value as { action?: { $case: ProtocolActionCase; value: unknown } | null }).action,
    "Edit action",
  );
  const decoded = fromProtocolValue(action.value) as Record<string, unknown>;
  if (action.$case === "fieldInitializationExpressionConfigure") {
    const expression = required(
      decoded.expression as Record<string, unknown> | null,
      "Field initialization expression",
    );
    decoded.expression = { kind: "find-field-values", ...expression };
  } else if (action.$case === "searchExpressionCreate") {
    decoded.expression = fromSearchExpressionDraft(decoded.expression);
  } else if (action.$case === "searchExpressionConfigure" || action.$case === "viewFilterExpressionConfigure") {
    decoded.clause = fromSearchClause(decoded.clause);
  } else if (action.$case === "searchExpressionAdd" || action.$case === "viewFilterExpressionAdd") {
    decoded.expression = fromSearchExpressionDraft(decoded.expression);
  } else if (action.$case === "viewFilterCreate") {
    decoded.expression = fromSearchExpressionDraft(decoded.expression);
  }
  for (const key of [
    "seed",
    "fieldDefinitionSeed",
    "intrinsicNodeType",
    "optionsSupertagId",
    "optionsSupertagOccurrenceId",
    "emptyValueNodeId",
    "emptyValueOccurrenceId",
  ] as const) {
    if (decoded[key] === null) {
      delete decoded[key];
    }
  }
  return { ...decoded, kind: actionKind(action.$case) } as EditAction;
}

function assertActionFields(action: EditAction): void {
  const $case = protocolActionCase(action.kind);
  const field = EditActionSchema.oneofs[0]?.fields.find((candidate) => candidate.localName === $case);
  const allowed = new Set(["kind", ...(field?.message?.fields.map((candidate) => candidate.localName) ?? [])]);
  const unknown = Object.keys(action).find((key) => !allowed.has(key));
  if (unknown) {
    throw new Error(`Unknown input field: ${unknown}`);
  }
}

function toQueryValue(query: EngineQuery, value: unknown): unknown {
  if (query.kind === "invocation") {
    return toInvocationOutcome(value as InvocationOutcome);
  }
  if (query.kind === "projection") {
    return toProjectionPage(value as ProjectionPage);
  }
  if (query.kind === "review") {
    return toReviewQuery(value as ReviewQuery);
  }
  if (query.kind === "history") {
    return toHistoryQuery(value as HistoryQuery);
  }
  if (query.kind === "conflicts") {
    const result = value as { issues: readonly ConflictIssue[] };
    return {
      ...(toProtocolValue(value) as Record<string, unknown>),
      issues: result.issues.map(toConflictIssue),
    };
  }
  if (query.kind === "debug-node") {
    return toDebugNodeResult(value as DebugNodeResult);
  }
  if (query.kind === "view-rows") {
    const result = value as ViewRowsResult;
    return { ...(toProtocolValue(result) as Record<string, unknown>), options: toViewOptionsSpec(result.options) };
  }
  return toProtocolValue(value);
}

function fromViewRowsResult(value: unknown): unknown {
  const result = fromProtocolValue(value) as Record<string, unknown>;
  result.options = fromViewOptionsSpec(result.options);
  return result;
}
