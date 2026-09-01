import type { PreviousValue as ProtocolPreviousValue } from "@lode/protocol/proto";

import type { JsonValue, PreviousValue } from "./model.js";
import { selectedCase, unsupportedProtocolCase } from "./protocol-decoding.js";
import type { ProtocolDto } from "./protocol-dto.js";
import { fromProtocolValue, toProtocolValue } from "./protocol-value-codec.js";

export function toPreviousValue(value: PreviousValue): Record<string, unknown> {
  return value.kind === "unset"
    ? { state: { case: "unset", value: {} } }
    : { state: { case: "set", value: toProtocolValue(value.value) } };
}

export function fromPreviousValue(value: unknown): PreviousValue {
  const selected = selectedCase((value as ProtocolDto<ProtocolPreviousValue>).state, "Previous value");
  switch (selected.case) {
    case "unset":
      return { kind: "unset" };
    case "set":
      return { kind: "set", value: fromProtocolValue(selected.value) as JsonValue };
    default:
      return unsupportedProtocolCase(selected, "Previous value");
  }
}
