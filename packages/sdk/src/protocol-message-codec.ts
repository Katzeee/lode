import { fromJson, toJson, ScalarType, type DescEnum, type DescField, type DescMessage } from "@bufbuild/protobuf";
import { ValueSchema, type Value } from "@bufbuild/protobuf/wkt";

import { protocolEnumCodecs } from "./protocol-enum-codecs.js";

const SIXTY_FOUR_BIT_SCALARS: ReadonlySet<ScalarType> = new Set([
  ScalarType.INT64,
  ScalarType.UINT64,
  ScalarType.FIXED64,
  ScalarType.SFIXED64,
  ScalarType.SINT64,
]);

type Direction = "encode" | "decode";

/** Domain record → protobuf-es init shape: enum names to numbers, null to absent, JSON values wrapped. */
export function toProtocolMessage(schema: DescMessage, value: unknown): unknown {
  return transformMessage(schema, value, "encode");
}

/** protobuf-es message → domain shape: enum names, absent fields as null, 64-bit as number, JSON unwrapped. */
export function fromProtocolMessage(schema: DescMessage, value: unknown): unknown {
  return transformMessage(schema, value, "decode");
}

function transformMessage(schema: DescMessage, value: unknown, direction: Direction): unknown {
  if (schema.typeName === "google.protobuf.Value") {
    return direction === "encode" ? fromJson(ValueSchema, value as never) : toJson(ValueSchema, value as Value);
  }
  if (!isRecord(value)) {
    return value;
  }
  const result: Record<string, unknown> = { ...value };
  delete result.$typeName;
  delete result.$unknown;
  for (const field of schema.fields) {
    if (field.oneof) {
      transformOneof(result, field, direction);
    } else if (result[field.localName] === null || result[field.localName] === undefined) {
      if (direction === "encode") {
        delete result[field.localName];
      } else {
        result[field.localName] = null;
      }
    } else {
      result[field.localName] = transformField(field, result[field.localName], direction);
    }
  }
  return result;
}

function transformOneof(result: Record<string, unknown>, field: DescField, direction: Direction): void {
  const groupName = field.oneof?.localName;
  if (!groupName) {
    return;
  }
  const selected = result[groupName];
  if (!isRecord(selected) || selected.case !== field.localName) {
    return;
  }
  result[groupName] = {
    case: selected.case,
    value: transformField(field, selected.value, direction),
  };
}

function transformField(field: DescField, value: unknown, direction: Direction): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (field.fieldKind === "enum") {
    return transformEnum(field.enum, value, direction);
  }
  if (field.fieldKind === "message") {
    return transformMessage(field.message, value, direction);
  }
  if (field.fieldKind === "scalar") {
    return transformScalar(field.scalar, value, direction);
  }
  if (field.fieldKind === "list") {
    if (!Array.isArray(value)) {
      return value;
    }
    if (field.listKind === "enum") {
      return value.map((item) => transformEnum(field.enum, item, direction));
    }
    if (field.listKind === "message") {
      return value.map((item) => transformBoxedMessage(field.message, item, direction));
    }
    return value.map((item) => transformScalar(field.scalar, item, direction));
  }
  if (!isRecord(value)) {
    return value;
  }
  if (field.mapKind === "enum") {
    return mapRecord(value, (item) => transformEnum(field.enum, item, direction));
  }
  if (field.mapKind === "message") {
    return mapRecord(value, (item) => transformBoxedMessage(field.message, item, direction));
  }
  return mapRecord(value, (item) => transformScalar(field.scalar, item, direction));
}

/**
 * protobuf-es unboxes singular wrapper fields but keeps wrappers boxed inside
 * maps and lists, where an absent domain value crosses the wire as the
 * wrapper's default message.
 */
function transformBoxedMessage(schema: DescMessage, value: unknown, direction: Direction): unknown {
  if (schema.typeName !== "google.protobuf.StringValue") {
    return transformMessage(schema, value, direction);
  }
  if (direction === "encode") {
    return { value: value ?? "" };
  }
  const boxed = (value ?? {}) as Readonly<{ value?: string }>;
  return boxed.value ? boxed.value : null;
}

function transformScalar(scalar: ScalarType, value: unknown, direction: Direction): unknown {
  if (!SIXTY_FOUR_BIT_SCALARS.has(scalar)) {
    return value;
  }
  if (direction === "encode") {
    return typeof value === "number" ? BigInt(value) : value;
  }
  return typeof value === "bigint" ? Number(value) : value;
}

function transformEnum(descEnum: DescEnum, value: unknown, direction: Direction): unknown {
  const codec = protocolEnumCodecs.get(descEnum.typeName);
  if (!codec) {
    if (descEnum.typeName.startsWith("lode.")) {
      throw new Error(`SDK has no enum adapter for ${descEnum.typeName}`);
    }
    return value;
  }
  if (direction === "encode") {
    return typeof value === "number" ? value : codec.encode(value as string);
  }
  return typeof value === "string" ? value : codec.decode(value as number);
}

function mapRecord(
  value: Readonly<Record<string, unknown>>,
  transform: (item: unknown) => unknown,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
