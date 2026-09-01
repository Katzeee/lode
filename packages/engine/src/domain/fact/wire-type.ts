/**
 * Proto shape of a field that crosses the public edit surface. The wire generator reads these
 * tags off the edit registry (and off direct-access action definitions) to emit edit.proto;
 * message and enum names refer to hand-written types in the lode proto package.
 */
export type WireType =
  | Readonly<{ kind: "scalar"; scalar: "string" | "double" | "bool" }>
  | Readonly<{ kind: "message"; message: string }>
  | Readonly<{ kind: "enum"; enum: string }>
  | Readonly<{ kind: "string-value" }>
  | Readonly<{ kind: "string-list" }>
  | Readonly<{ kind: "json-map" }>;

export const STRING_WIRE: WireType = { kind: "scalar", scalar: "string" };
