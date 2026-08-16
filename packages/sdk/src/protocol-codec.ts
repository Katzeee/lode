import {
  EngineCommand as ProtocolEngineCommand,
  EngineEvent as ProtocolEngineEvent,
  EngineQuery as ProtocolEngineQuery,
  QueryResult as ProtocolQueryResult,
  WriteResult as ProtocolWriteResult,
} from "@lode/protocol/dto/engine";
import {
  EditMutationSchema,
  EngineCommandSchema,
  EngineEventSchema,
  EngineQuerySchema,
  QueryResultSchema,
  WriteResultSchema,
} from "@lode/protocol/proto";
import type { EditMutation } from "./edit.js";
import type { HistoryQuery, HistorySelection } from "./history.js";
import type {
  EngineCommand,
  EngineError,
  EngineEvent,
  EngineQuery,
  EngineQueryResult,
  InvocationOutcome,
  WriteResult,
} from "./contract.js";
import type { ProjectionPage } from "./projection.js";
import type { ConflictIssue, ReviewQuery } from "./review.js";
import { fromProjectionPage, toProjectionPage } from "./protocol-projection-codec.js";
import {
  commandKind,
  mutationKind,
  protocolCommandCase,
  protocolMutationCase,
  protocolQueryCase,
  protocolWriteResultCase,
  queryKind,
  writeResultStatus,
  type ProtocolMutationCase,
} from "./protocol-cases.js";
import {
  fromSupertagFieldConfig,
  fromInvocationOutcome,
  fromProtocolValue,
  fromReviewQuery,
  fromReviewSelection,
  required,
  toConflictIssue,
  toSupertagFieldConfig,
  toInvocationOutcome,
  toProtocolValue,
  toReviewQuery,
  toReviewSelection,
} from "./protocol-shape-codec.js";
import { fromProtocolMessage, toProtocolMessage } from "./protocol-message-codec.js";
import { fromContributionMutation, toContributionMutation } from "./protocol-fact-codec.js";

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
  if (selected.$case === "mutate") {
    decoded.mutations = selected.value.mutations.map(fromEditMutation);
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
  if (command.kind === "mutate") {
    value.mutations = command.mutations.map(toEditMutation);
  } else if (command.kind === "resolve-review") {
    value.selection = toReviewSelection(command.selection);
  } else if (command.kind === "undo" || command.kind === "redo") {
    value.selection = toHistorySelection(command.selection);
  }
  return { $case: protocolCommandCase(command.kind), value };
}

function toEditMutation(mutation: EditMutation): Record<string, unknown> {
  assertMutationFields(mutation);
  const value = toProtocolValue(mutation) as Record<string, unknown>;
  if (mutation.kind === "supertag-field-configure") {
    value.config = toSupertagFieldConfig(mutation.config);
  } else if (
    mutation.kind === "field-initialization-expression-configure" ||
    mutation.kind === "field-initialization-expression-configuration-create"
  ) {
    value.expression = { sourceFieldDefinitionId: mutation.expression.sourceFieldDefinitionId };
  }
  return { mutation: { $case: protocolMutationCase(mutation.kind), value } };
}

function fromEditMutation(value: unknown): EditMutation {
  const mutation = required(
    (value as { mutation?: { $case: ProtocolMutationCase; value: unknown } | null }).mutation,
    "Edit mutation",
  );
  const decoded = fromProtocolValue(mutation.value) as Record<string, unknown>;
  if (mutation.$case === "supertagFieldConfigure") {
    decoded.config = fromSupertagFieldConfig(decoded.config);
  } else if (
    mutation.$case === "fieldInitializationExpressionConfigure" ||
    mutation.$case === "fieldInitializationExpressionConfigurationCreate"
  ) {
    const expression = required(
      decoded.expression as Record<string, unknown> | null,
      "Field initialization expression",
    );
    decoded.expression = {
      kind: "ancestor-field-values",
      sourceFieldDefinitionId: expression.sourceFieldDefinitionId,
    };
  }
  for (const key of ["seed", "nodeType", "previousParentNodeId", "previousAnchor"] as const) {
    if (decoded[key] === null) {
      delete decoded[key];
    }
  }
  for (const key of ["sourceSupertagIds", "sourceApplicationSupertagIds", "sourceTemplateOccurrenceIds"] as const) {
    if (Array.isArray(decoded[key]) && decoded[key].length === 0) {
      delete decoded[key];
    }
  }
  if (mutation.$case === "sharedDefaultViewDefinitionModeSet") {
    delete decoded.previousViewType;
    delete decoded.observedModeFactIds;
  }
  return { ...decoded, kind: mutationKind(mutation.$case) } as EditMutation;
}

function assertMutationFields(mutation: EditMutation): void {
  const $case = protocolMutationCase(mutation.kind);
  const field = EditMutationSchema.oneofs[0]?.fields.find((candidate) => candidate.localName === $case);
  const allowed = new Set(["kind", ...(field?.message?.fields.map((candidate) => candidate.localName) ?? [])]);
  const unknown = Object.keys(mutation).find((key) => !allowed.has(key));
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
  return toProtocolValue(value);
}

function toHistorySelection(selection: HistorySelection): Record<string, unknown> {
  const value = toProtocolValue(selection) as Record<string, unknown>;
  value.evidence = {
    ...(toProtocolValue(selection.evidence) as Record<string, unknown>),
    compensations: selection.evidence.compensations.map(toContributionMutation),
  };
  return value;
}

function fromHistorySelection(value: unknown): HistorySelection {
  const selection = fromProtocolValue(value) as Record<string, unknown>;
  const evidence = required(selection.evidence as Record<string, unknown> | null, "History evidence");
  selection.evidence = {
    ...evidence,
    compensations: (evidence.compensations as readonly unknown[]).map(fromContributionMutation),
  };
  return selection as HistorySelection;
}

function toHistoryQuery(value: HistoryQuery): Record<string, unknown> {
  return {
    ...(toProtocolValue(value) as Record<string, unknown>),
    undo: value.undo === null ? null : toHistorySelection(value.undo),
    redo: value.redo === null ? null : toHistorySelection(value.redo),
  };
}

function fromHistoryQuery(value: unknown): HistoryQuery {
  const result = fromProtocolValue(value) as Record<string, unknown>;
  result.undo = result.undo === null ? null : fromHistorySelection(result.undo);
  result.redo = result.redo === null ? null : fromHistorySelection(result.redo);
  return result as HistoryQuery;
}
