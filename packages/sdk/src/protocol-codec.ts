import { create, fromBinary, toBinary, type MessageInitShape } from "@bufbuild/protobuf";
import {
  EngineCommandSchema,
  EngineEventSchema,
  EngineQuerySchema,
  QueryResultSchema,
  WriteResultSchema,
  type EngineCommand as ProtocolEngineCommand,
  type EngineEvent as ProtocolEngineEvent,
  type EngineQuery as ProtocolEngineQuery,
  type QueryResult as ProtocolQueryResult,
  type WriteResult as ProtocolWriteResult,
} from "@lode/protocol/proto";
import type { HistoryQuery } from "./history.js";
import type {
  EngineCommand,
  EngineError,
  EngineEvent,
  EngineQuery,
  EngineQueryResult,
  InvocationOutcome,
  ViewRowsResult,
  WriteResult,
} from "./contract.js";
import type { ProjectionPage } from "./projection.js";
import type { ProtocolDto } from "./protocol-dto.js";
import type { ReviewQuery } from "./review.js";
import { fromProjectionPage, toProjectionPage } from "./protocol-projection-codec.js";
import {
  commandKind,
  protocolCommandCase,
  protocolQueryCase,
  protocolWriteResultCase,
  queryKind,
  writeResultStatus,
  type ProtocolCommandCase,
} from "./protocol-cases.js";
import {
  fromInvocationOutcome,
  fromReviewQuery,
  fromReviewSelection,
  toInvocationOutcome,
  toReviewQuery,
  toReviewSelection,
} from "./protocol-shape-codec.js";
import { fromConflictQueryResult, toConflictQueryResult } from "./protocol-conflict-codec.js";
import { selectedCase } from "./protocol-decoding.js";
import { fromEditAction, toEditAction } from "./protocol-edit-action-codec.js";
import { fromProtocolMessage, toProtocolMessage } from "./protocol-message-codec.js";
import { fromProtocolValue, toProtocolValue } from "./protocol-value-codec.js";
import {
  fromHistoryQuery,
  fromHistorySelection,
  toHistoryQuery,
  toHistorySelection,
} from "./protocol-history-codec.js";
import { fromViewOptionsSpec, toViewOptionsSpec } from "./protocol-view-options-codec.js";

export function engineCommandToMessage(command: EngineCommand): ProtocolEngineCommand {
  const value = toProtocolMessage(EngineCommandSchema, { command: commandValue(command) });
  return create(EngineCommandSchema, value as MessageInitShape<typeof EngineCommandSchema>);
}

export function engineCommandFromMessage(message: ProtocolEngineCommand): EngineCommand {
  const walked = fromProtocolMessage(EngineCommandSchema, message) as ProtocolDto<ProtocolEngineCommand>;
  const selected = selectedCase(walked.command, "Engine command");
  const decoded = fromProtocolValue(selected.value) as Record<string, unknown>;
  if (selected.case === "edit") {
    decoded.actions = selected.value.actions.map(fromEditAction);
  } else if (selected.case === "resolveReview") {
    decoded.selection = fromReviewSelection(selected.value.selection);
  } else if (selected.case === "undo" || selected.case === "redo") {
    decoded.selection = fromHistorySelection(selected.value.selection);
  }
  return { ...decoded, kind: commandKind(selected.case) } as EngineCommand;
}

export function encodeEngineCommand(command: EngineCommand): Uint8Array {
  return toBinary(EngineCommandSchema, engineCommandToMessage(command));
}

export function decodeEngineCommand(bytes: Uint8Array): EngineCommand {
  return engineCommandFromMessage(fromBinary(EngineCommandSchema, bytes));
}

export function engineQueryToMessage(query: EngineQuery): ProtocolEngineQuery {
  const message = toProtocolMessage(EngineQuerySchema, {
    query: { case: protocolQueryCase(query.kind), value: toProtocolValue(query) },
  });
  return create(EngineQuerySchema, message as MessageInitShape<typeof EngineQuerySchema>);
}

export function engineQueryFromMessage(message: ProtocolEngineQuery): EngineQuery {
  const walked = fromProtocolMessage(EngineQuerySchema, message) as ProtocolDto<ProtocolEngineQuery>;
  const selected = selectedCase(walked.query, "Engine query");
  const value = fromProtocolValue(selected.value) as Record<string, unknown>;
  for (const key of ["section", "after", "limit", "viewDefinitionNodeId"] as const) {
    if (value[key] === null) {
      delete value[key];
    }
  }
  return { ...value, kind: queryKind(selected.case) } as EngineQuery;
}

export function encodeEngineQuery(query: EngineQuery): Uint8Array {
  return toBinary(EngineQuerySchema, engineQueryToMessage(query));
}

export function decodeEngineQuery(bytes: Uint8Array): EngineQuery {
  return engineQueryFromMessage(fromBinary(EngineQuerySchema, bytes));
}

export function writeResultToMessage(result: WriteResult): ProtocolWriteResult {
  const message = toProtocolMessage(WriteResultSchema, {
    result: { case: protocolWriteResultCase(result.status), value: toProtocolValue(result) },
  });
  return create(WriteResultSchema, message as MessageInitShape<typeof WriteResultSchema>);
}

export function writeResultFromMessage(message: ProtocolWriteResult): WriteResult {
  const walked = fromProtocolMessage(WriteResultSchema, message) as ProtocolDto<ProtocolWriteResult>;
  const selected = selectedCase(walked.result, "Engine write result");
  return {
    ...(fromProtocolValue(selected.value) as Record<string, unknown>),
    status: writeResultStatus(selected.case),
  } as WriteResult;
}

export function encodeWriteResult(result: WriteResult): Uint8Array {
  return toBinary(WriteResultSchema, writeResultToMessage(result));
}

export function decodeWriteResult(bytes: Uint8Array): WriteResult {
  return writeResultFromMessage(fromBinary(WriteResultSchema, bytes));
}

export function queryResultToMessage(query: EngineQuery, result: EngineQueryResult): ProtocolQueryResult {
  const message =
    result.status === "rejected"
      ? toProtocolMessage(QueryResultSchema, { result: { case: "rejected", value: errorValue(result.error) } })
      : toProtocolMessage(QueryResultSchema, {
          result: { case: protocolQueryCase(query.kind), value: toQueryValue(query, result.value) },
        });
  return create(QueryResultSchema, message as MessageInitShape<typeof QueryResultSchema>);
}

export function queryResultFromMessage<Query extends EngineQuery>(
  message: ProtocolQueryResult,
  query: Query,
): EngineQueryResult<Query> {
  const walked = fromProtocolMessage(QueryResultSchema, message) as ProtocolDto<ProtocolQueryResult>;
  const selected = selectedCase(walked.result, "Engine query result");
  if (selected.case === "rejected") {
    return { status: "rejected", error: fromProtocolValue(selected.value) } as EngineQueryResult<Query>;
  }
  const expected = protocolQueryCase(query.kind);
  if (selected.case !== expected) {
    throw new Error(`Engine query result ${selected.case} does not match ${query.kind}`);
  }
  const value =
    selected.case === "invocation"
      ? fromInvocationOutcome(selected.value)
      : selected.case === "projection"
        ? fromProjectionPage(selected.value)
        : selected.case === "review"
          ? fromReviewQuery(selected.value)
          : selected.case === "history"
            ? fromHistoryQuery(selected.value)
            : selected.case === "viewRows"
              ? fromViewRowsResult(selected.value)
              : selected.case === "conflicts"
                ? fromConflictQueryResult(selected.value)
                : fromProtocolValue(selected.value);
  return { status: "ok", value } as EngineQueryResult<Query>;
}

export function encodeEngineQueryResult(query: EngineQuery, result: EngineQueryResult): Uint8Array {
  return toBinary(QueryResultSchema, queryResultToMessage(query, result));
}

export function decodeEngineQueryResult<Query extends EngineQuery>(
  bytes: Uint8Array,
  query: Query,
): EngineQueryResult<Query> {
  return queryResultFromMessage(fromBinary(QueryResultSchema, bytes), query);
}

export function engineEventToMessage(event: EngineEvent): ProtocolEngineEvent {
  const message = toProtocolMessage(EngineEventSchema, toProtocolValue(event));
  return create(EngineEventSchema, message as MessageInitShape<typeof EngineEventSchema>);
}

export function engineEventFromMessage(message: ProtocolEngineEvent): EngineEvent {
  const walked = fromProtocolMessage(EngineEventSchema, message);
  return fromProtocolValue(walked) as EngineEvent;
}

export function encodeEngineEvent(event: EngineEvent): Uint8Array {
  return toBinary(EngineEventSchema, engineEventToMessage(event));
}

export function decodeEngineEvent(bytes: Uint8Array): EngineEvent {
  return engineEventFromMessage(fromBinary(EngineEventSchema, bytes));
}

function commandValue(command: EngineCommand): Readonly<{ case: ProtocolCommandCase; value: unknown }> {
  const value = toProtocolValue(command) as Record<string, unknown>;
  if (command.kind === "edit") {
    value.actions = command.actions.map(toEditAction);
  } else if (command.kind === "resolve-review") {
    value.selection = toReviewSelection(command.selection);
  } else if (command.kind === "undo" || command.kind === "redo") {
    value.selection = toHistorySelection(command.selection);
  }
  return { case: protocolCommandCase(command.kind), value };
}

function errorValue(error: EngineError): unknown {
  return toProtocolValue(error);
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
    return toConflictQueryResult(value);
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
