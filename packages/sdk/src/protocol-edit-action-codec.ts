import { EditActionSchema } from "@lode/protocol/proto";
import type { EditAction } from "./edit.js";
import { actionKind, protocolActionCase, type ProtocolActionCase } from "./protocol-cases.js";
import { required, selectedCase } from "./protocol-decoding.js";
import { ProtocolInputEncodingError } from "./protocol-input-error.js";
import { fromPreviousValue, toPreviousValue } from "./protocol-previous-value-codec.js";
import {
  fromSearchClause,
  fromSearchExpressionDraft,
  toSearchClause,
  toSearchExpressionDraft,
} from "./protocol-search-expression-codec.js";
import { fromProtocolValue, toProtocolValue } from "./protocol-value-codec.js";

export function toEditAction(action: EditAction): Record<string, unknown> {
  assertActionFields(action);
  const value = toProtocolValue(action) as Record<string, unknown>;
  if (action.kind === "rich-text-mark") {
    value.value = toPreviousValue(action.value);
  } else if (action.kind === "field-initialization-expression-configure") {
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
  return { action: { case: protocolActionCase(action.kind), value } };
}

export function fromEditAction(value: unknown): EditAction {
  const action = selectedCase(
    (
      value as Readonly<{
        action?: Readonly<{ case: ProtocolActionCase; value: unknown }> | Readonly<{ case: undefined }> | null;
      }>
    ).action,
    "Edit action",
  );
  const decoded = fromProtocolValue(action.value) as Record<string, unknown>;
  if (action.case === "richTextMark") {
    decoded.value = fromPreviousValue(decoded.value);
  } else if (action.case === "fieldInitializationExpressionConfigure") {
    const expression = required(
      decoded.expression as Record<string, unknown> | null,
      "Field initialization expression",
    );
    decoded.expression = { kind: "find-field-values", ...expression };
  } else if (action.case === "searchExpressionCreate") {
    decoded.expression = fromSearchExpressionDraft(decoded.expression);
  } else if (action.case === "searchExpressionConfigure" || action.case === "viewFilterExpressionConfigure") {
    decoded.clause = fromSearchClause(decoded.clause);
  } else if (action.case === "searchExpressionAdd" || action.case === "viewFilterExpressionAdd") {
    decoded.expression = fromSearchExpressionDraft(decoded.expression);
  } else if (action.case === "viewFilterCreate") {
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
  return { ...decoded, kind: actionKind(action.case) } as EditAction;
}

function assertActionFields(action: EditAction): void {
  const protocolCase = protocolActionCase(action.kind);
  const actionOneof = EditActionSchema.oneofs.find((oneof) => oneof.localName === "action");
  if (actionOneof === undefined) {
    throw new Error("Generated EditAction schema is missing its action oneof");
  }
  const field = actionOneof.fields.find((candidate) => candidate.localName === protocolCase);
  if (field?.message === undefined) {
    throw new Error(`Generated EditAction schema is missing message field ${protocolCase}`);
  }
  const allowed = new Set(["kind", ...field.message.fields.map((candidate) => candidate.localName)]);
  const unknown = Object.keys(action).find((key) => !allowed.has(key));
  if (unknown) {
    throw new ProtocolInputEncodingError(`Unknown input field: ${unknown}`);
  }
}
