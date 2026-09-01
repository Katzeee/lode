import type { JsonValue } from "./model.js";

type IsAny<Value> = 0 extends 1 & Value ? true : false;

/**
 * Maps a generated protobuf-es message type to the shape the SDK's domain
 * types and the generic message codec exchange at runtime:
 * - `$typeName` / `$unknown` bookkeeping is stripped,
 * - absent fields (wrappers, singular messages, proto3 optionals) surface as
 *   `null` rather than `undefined`,
 * - unset oneof groups keep protobuf-es's `{ case: undefined }` marker,
 * - 64-bit integers surface as `number`,
 * - `google.protobuf.Value` surfaces as domain {@link JsonValue}.
 */
export type ProtocolDto<Value> =
  IsAny<Value> extends true
    ? JsonValue
    : Value extends bigint
      ? number
      : Value extends Readonly<{ $typeName: "google.protobuf.Value" }>
        ? JsonValue
        : Value extends readonly (infer Item)[]
          ? readonly ProtocolDto<Item>[]
          : Value extends Readonly<{ case: undefined }>
            ? Value
            : Value extends object
              ? {
                  readonly [Key in keyof Omit<Value, "$typeName" | "$unknown">]-?: undefined extends Value[Key]
                    ? ProtocolDto<Exclude<Value[Key], undefined>> | null
                    : ProtocolDto<Value[Key]>;
                }
              : Value;

/** The protobuf DTO shape with its oneof-case discriminant renamed to the domain kind literal. */
export type WithKind<Value, Kind extends string> = Omit<ProtocolDto<Value>, "kind"> & Readonly<{ kind: Kind }>;
