import { fromJson, toJson, type JsonObject, type JsonValue } from "@bufbuild/protobuf";
import { ValueSchema, type Value } from "@bufbuild/protobuf/wkt";

// v2 represents google.protobuf.Struct fields as plain JsonObject, so Struct fields need
// no conversion at runtime — plain JS objects pass straight through (binary roundtrips
// intact). `asJsonObject` only satisfies the type at the write boundary. Only
// google.protobuf.Value (arbitrary scalar-or-object prop values) stays a Value message.
export function asJsonObject(
  record: Readonly<Record<string, unknown>> | undefined,
): JsonObject | undefined {
  return record as JsonObject | undefined;
}

export function toValue(value: unknown): Value {
  return fromJson(ValueSchema, value as JsonValue);
}

export function fromValue(value: Value | undefined): unknown {
  return value === undefined ? undefined : toJson(ValueSchema, value);
}
