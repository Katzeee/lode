import type { InlineReferenceTargetStatus as ProtocolInlineReferenceTargetStatus } from "@lode/protocol/proto";
import type {
  NodeContentItem as ProtocolNodeContentItem,
  TypedFieldValue as ProtocolTypedFieldValue,
  TypedFieldValueState as ProtocolTypedFieldValueState,
} from "@lode/protocol/proto";

import type { NodeContentItem, ProjectedNode, TypedFieldValue } from "./projection.js";
import { selectedCase, unsupportedProtocolCase, unsupportedProtocolValue } from "./protocol-decoding.js";
import type { ProtocolDto } from "./protocol-dto.js";
import { inlineReferenceTargetStatus } from "./protocol-enums/model.js";
import { typedFieldValueState } from "./protocol-enums/projection.js";

export function toTypedFieldValue(value: TypedFieldValue): Record<string, unknown> {
  const { value: semantic, ...base } = value;
  if (semantic === null) {
    return { ...base, semanticValue: undefined };
  }
  const { kind, ...fields } = semantic;
  switch (kind) {
    case "number":
      return { ...base, semanticValue: { case: "numberValue", value: fields } };
    case "date":
      return { ...base, semanticValue: { case: "dateValue", value: fields } };
    case "checkbox":
      return { ...base, semanticValue: { case: "checkboxValue", value: fields } };
    case "options-from-supertag":
      return { ...base, semanticValue: { case: "optionsFromSupertagValue", value: fields } };
    default:
      return unsupportedProtocolValue(kind, "Typed Field semantic value kind");
  }
}

export function fromTypedFieldValue(value: unknown): TypedFieldValue {
  const item = value as Record<string, unknown>;
  const { semanticValue, ...base } = item;
  const group = semanticValue as ProtocolDto<ProtocolTypedFieldValue>["semanticValue"] | null | undefined;
  const state = decodeTypedFieldValueState(base.state);
  switch (state) {
    case "empty":
    case "invalid":
      // An unset protobuf-es oneof group surfaces as `{ case: undefined }`, not null.
      if (group !== null && group !== undefined && group.case !== undefined) {
        throw new Error(`Typed Field ${state} state has a semantic value`);
      }
      return { ...base, state, value: null } as TypedFieldValue;
    case "value":
      break;
    default:
      return unsupportedProtocolValue(state, "Typed Field value state");
  }
  const selected = selectedCase(group, "Typed Field semantic value");
  switch (selected.case) {
    case "numberValue":
      return { ...base, state: "value", value: { kind: "number", ...selected.value } } as TypedFieldValue;
    case "dateValue":
      return { ...base, state: "value", value: { kind: "date", ...selected.value } } as TypedFieldValue;
    case "checkboxValue":
      return { ...base, state: "value", value: { kind: "checkbox", ...selected.value } } as TypedFieldValue;
    case "optionsFromSupertagValue":
      return {
        ...base,
        state: "value",
        value: { kind: "options-from-supertag", ...selected.value },
      } as TypedFieldValue;
    default:
      return unsupportedProtocolCase(selected, "Typed Field semantic value");
  }
}

function decodeTypedFieldValueState(value: unknown): "empty" | "value" | "invalid" {
  if (typeof value === "string") {
    if (typedFieldValueState.values.includes(value as "empty" | "value" | "invalid")) {
      return value as "empty" | "value" | "invalid";
    }
    throw new Error(`Typed Field value state is invalid: ${value}`);
  }
  return typedFieldValueState.decode(value as ProtocolTypedFieldValueState);
}

export function toProjectedNode(node: ProjectedNode): Record<string, unknown> {
  return { ...node, content: node.content.map(toNodeContentItem) };
}

export function fromProjectedNode(value: unknown): ProjectedNode {
  const node = value as Record<string, unknown>;
  return {
    ...node,
    content: (node.content as readonly ProtocolDto<ProtocolNodeContentItem>[]).map((wrapper): NodeContentItem => {
      const selected = selectedCase(wrapper.content, "Projected Node content");
      switch (selected.case) {
        case "text":
          return { ...selected.value, kind: "text" } as NodeContentItem;
        case "inlineReference":
          return {
            ...selected.value,
            kind: "inline-reference",
            targetStatus: decodeInlineReferenceTargetStatus(selected.value.targetStatus),
          };
        default:
          return unsupportedProtocolCase(selected, "Projected Node content");
      }
    }),
  } as unknown as ProjectedNode;
}

function toNodeContentItem(item: NodeContentItem): Record<string, unknown> {
  const { kind, ...value } = item;
  switch (kind) {
    case "text":
      return { content: { case: "text", value } };
    case "inline-reference":
      return { content: { case: "inlineReference", value } };
    default:
      return unsupportedProtocolValue(kind, "Projected Node content kind");
  }
}

function decodeInlineReferenceTargetStatus(
  value: unknown,
): Extract<NodeContentItem, { kind: "inline-reference" }>["targetStatus"] {
  if (typeof value === "string") {
    if (inlineReferenceTargetStatus.values.includes(value as "active" | "trash" | "unavailable")) {
      return value as "active" | "trash" | "unavailable";
    }
    throw new Error(`Inline Reference target status is invalid: ${value}`);
  }
  return inlineReferenceTargetStatus.decode(value as ProtocolInlineReferenceTargetStatus);
}
