import { ProtocolInputEncodingError } from "./protocol-input-error.js";

export function toProtocolValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toProtocolValue);
  }
  if (!isRecord(value)) {
    if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
      throw new ProtocolInputEncodingError(`Unsupported protocol input value type: ${typeof value}`);
    }
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toProtocolValue(item)]));
}

export function fromProtocolValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(fromProtocolValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromProtocolValue(item)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
