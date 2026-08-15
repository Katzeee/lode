import { protocolEnumCodecs } from "./protocol-enum-codecs.js";

type ProtocolEnum = Readonly<{ typeName: string }>;
type ProtocolOneof = Readonly<{ localName: string }>;
type ProtocolFieldCommon = Readonly<{ localName: string; oneof?: ProtocolOneof }>;
type ProtocolField = ProtocolFieldCommon &
  (
    | Readonly<{ fieldKind: "enum"; enum: ProtocolEnum }>
    | Readonly<{ fieldKind: "message"; message: ProtocolMessage }>
    | Readonly<{ fieldKind: "list"; listKind: "scalar" }>
    | Readonly<{ fieldKind: "list"; listKind: "enum"; enum: ProtocolEnum }>
    | Readonly<{ fieldKind: "list"; listKind: "message"; message: ProtocolMessage }>
    | Readonly<{ fieldKind: "map"; mapKind: "scalar" }>
    | Readonly<{ fieldKind: "map"; mapKind: "enum"; enum: ProtocolEnum }>
    | Readonly<{ fieldKind: "map"; mapKind: "message"; message: ProtocolMessage }>
    | Readonly<{ fieldKind: "scalar" }>
  );
type ProtocolMessage = Readonly<{
  fields: readonly ProtocolField[];
}>;

export function toProtocolMessage(schema: ProtocolMessage, value: unknown): unknown {
  return transformMessage(schema, value, "encode");
}

export function fromProtocolMessage(schema: ProtocolMessage, value: unknown): unknown {
  return transformMessage(schema, value, "decode");
}

function transformMessage(schema: ProtocolMessage, value: unknown, direction: "encode" | "decode"): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const result: Record<string, unknown> = { ...value };
  for (const field of schema.fields) {
    if (field.oneof) {
      transformOneof(result, field, direction);
    } else if (field.localName in result) {
      result[field.localName] = transformField(field, result[field.localName], direction);
    }
  }
  return result;
}

function transformOneof(result: Record<string, unknown>, field: ProtocolField, direction: "encode" | "decode"): void {
  const groupName = field.oneof?.localName;
  if (!groupName) {
    return;
  }
  const selected = result[groupName];
  if (!isRecord(selected)) {
    return;
  }
  const selectedCase = selected.$case ?? selected.case;
  if (selectedCase !== field.localName) {
    return;
  }
  result[groupName] = {
    ...selected,
    value: transformField(field, selected.value, direction),
  };
}

function transformField(field: ProtocolField, value: unknown, direction: "encode" | "decode"): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (field.fieldKind === "enum") {
    return transformEnum(field.enum.typeName, value, direction);
  }
  if (field.fieldKind === "message") {
    return transformMessage(field.message, value, direction);
  }
  if (field.fieldKind === "list") {
    if (!Array.isArray(value)) {
      return value;
    }
    if (field.listKind === "enum") {
      return value.map((item) => transformEnum(field.enum.typeName, item, direction));
    }
    if (field.listKind === "message") {
      return value.map((item) => transformMessage(field.message, item, direction));
    }
    return value;
  }
  if (field.fieldKind === "map" && isRecord(value)) {
    if (field.mapKind === "enum") {
      return mapRecord(value, (item) => transformEnum(field.enum.typeName, item, direction));
    }
    if (field.mapKind === "message") {
      return mapRecord(value, (item) => transformMessage(field.message, item, direction));
    }
  }
  return value;
}

function transformEnum(typeName: string, value: unknown, direction: "encode" | "decode"): unknown {
  const codec = protocolEnumCodecs.get(typeName);
  if (!codec) {
    if (typeName.startsWith("lode.")) {
      throw new Error(`SDK has no enum adapter for ${typeName}`);
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
