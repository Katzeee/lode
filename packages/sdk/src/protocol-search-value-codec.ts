import {
  SearchDateComparisonOperator,
  type SearchFieldValue as ProtocolSearchFieldValue,
  type SearchScopeTarget as ProtocolSearchScopeTarget,
} from "@lode/protocol/proto";

import type { SearchFieldValue, SearchScopeTarget } from "./model.js";
import { selectedCase, unsupportedProtocolCase, unsupportedProtocolValue } from "./protocol-decoding.js";

export function fieldValueToProtocol(value: SearchFieldValue): Record<string, unknown> {
  if (value.kind === "node") {
    return { value: { case: "nodeId", value: value.nodeId } };
  }
  return { value: { case: value.kind, value: value.value } };
}

export function fieldValueFromProtocol(value: ProtocolSearchFieldValue): SearchFieldValue {
  const selected = selectedCase(value.value, "Search Field value");
  switch (selected.case) {
    case "nodeId":
      return { kind: "node", nodeId: selected.value };
    case "text":
      return { kind: "text", value: selected.value };
    case "number":
      return { kind: "number", value: selected.value };
    case "checkbox":
      return { kind: "checkbox", value: selected.value };
    case "date":
      return { kind: "date", value: selected.value };
    default:
      return unsupportedProtocolCase(selected, "Search Field value");
  }
}

export function scopeTargetToProtocol(target: SearchScopeTarget): Record<string, unknown> {
  return {
    target: target.kind === "node" ? { case: "nodeId", value: target.nodeId } : { case: target.kind, value: {} },
  };
}

export function scopeTargetFromProtocol(value: ProtocolSearchScopeTarget): SearchScopeTarget {
  const selected = selectedCase(value.target, "Search scope target");
  switch (selected.case) {
    case "nodeId":
      return { kind: "node", nodeId: selected.value };
    case "parent":
      return { kind: "parent" };
    case "grandparent":
      return { kind: "grandparent" };
    default:
      return unsupportedProtocolCase(selected, "Search scope target");
  }
}

export function dateComparisonOperatorFromProtocol(value: SearchDateComparisonOperator | "gt" | "lt"): "gt" | "lt" {
  switch (value) {
    case "lt":
    case SearchDateComparisonOperator.LT:
      return "lt";
    case "gt":
    case SearchDateComparisonOperator.GT:
      return "gt";
    case SearchDateComparisonOperator.UNSPECIFIED:
      throw new Error(`Search date comparison operator has unsupported value ${String(value)}`);
    default:
      return unsupportedProtocolValue(value, "Search date comparison operator");
  }
}
