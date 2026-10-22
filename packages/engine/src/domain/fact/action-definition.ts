import { object, ShapeValidationError } from "../../decoding/index.js";
import type { SemanticContribution } from "./action-contribution-types.js";
import type { WireType } from "./wire-type.js";

export type ActionAdmission = "proposable" | "direct-only" | "terminal";

/**
 * How the public edit vocabulary reaches this action: "direct" actions are accepted verbatim as
 * authored edits, "composite" actions are only produced by expanding a dedicated edit shape, and
 * "internal" actions are never authored through the edit surface. Terminal actions are not Graph
 * Actions, so they always declare "internal".
 */
export type ActionEditAccess = "direct" | "composite" | "internal";

type FieldDecoder<Output, Optional extends boolean = false> = Readonly<{
  optional: Optional;
  /** Present on fields of direct-access actions, which appear verbatim on the public edit wire. */
  wire?: WireType;
  parse(value: unknown, label: string): Output;
}>;

type AnyFieldDecoder = FieldDecoder<unknown, boolean>;
type ActionFields = Readonly<Record<string, AnyFieldDecoder>>;

type OutputOf<Decoder extends AnyFieldDecoder> = Decoder extends FieldDecoder<infer Output, boolean> ? Output : never;
type RequiredFieldNames<Fields extends ActionFields> = {
  [Name in keyof Fields]: Fields[Name]["optional"] extends true ? never : Name;
}[keyof Fields];
type OptionalFieldNames<Fields extends ActionFields> = Exclude<keyof Fields, RequiredFieldNames<Fields>>;

type DecodedFields<Fields extends ActionFields> = Readonly<
  { [Name in RequiredFieldNames<Fields>]: OutputOf<Fields[Name]> } & {
    [Name in OptionalFieldNames<Fields>]?: Exclude<OutputOf<Fields[Name]>, undefined>;
  }
>;

type DecodedAction<Kind extends string, Fields extends ActionFields> = Readonly<{ kind: Kind }> & DecodedFields<Fields>;

type ActionDefinition<
  Kind extends string = string,
  Admission extends ActionAdmission = ActionAdmission,
  EditAccess extends ActionEditAccess = ActionEditAccess,
  Fields extends ActionFields = ActionFields,
  Contributions extends readonly SemanticContribution[] = readonly SemanticContribution[],
> = Readonly<{
  kind: Kind;
  admission: Admission;
  editAccess: EditAccess;
  fields: Fields;
  parse(value: unknown): DecodedAction<Kind, Fields>;
  contributions(action: DecodedAction<Kind, Fields>): Contributions;
}>;

export type AnyActionDefinition = ActionDefinition<
  string,
  ActionAdmission,
  ActionEditAccess,
  ActionFields,
  readonly SemanticContribution[]
>;
export type ActionOf<Definition extends AnyActionDefinition> = ReturnType<Definition["parse"]>;
export type ActionContributionsOf<Definition extends AnyActionDefinition> = ReturnType<Definition["contributions"]>;
export type ActionFamilyDefinition = Readonly<Record<string, AnyActionDefinition>>;

export function defineAction<
  const Kind extends string,
  const Admission extends ActionAdmission,
  const EditAccess extends (Admission extends "terminal" ? "internal" : ActionEditAccess),
  const Fields extends ActionFields,
  const Contributions extends readonly SemanticContribution[],
>(
  kind: Kind,
  admission: Admission,
  editAccess: EditAccess,
  fields: Fields,
  contributions: (action: DecodedAction<Kind, Fields>) => Contributions,
): ActionDefinition<Kind, Admission, EditAccess, Fields, Contributions> {
  return {
    kind,
    admission,
    editAccess,
    fields,
    parse(value: unknown) {
      const record = object(value, `${kind} Authored Action`);
      if (record.kind !== kind) {
        throw new ShapeValidationError(`Expected ${kind} Authored Action`);
      }
      const allowedKeys = new Set(["kind", ...Object.keys(fields)]);
      const unknownKey = Object.keys(record).find((name) => !allowedKeys.has(name));
      if (unknownKey) {
        throw new ShapeValidationError(`${kind} Authored Action contains unknown field: ${unknownKey}`);
      }
      for (const [name, decoder] of Object.entries(fields)) {
        if (!(name in record) && !decoder.optional) {
          throw new ShapeValidationError(`${kind} Authored Action is missing ${name}`);
        }
        decoder.parse(record[name], `${kind}.${name}`);
      }
      return value as Readonly<{ kind: Kind }> & DecodedFields<Fields>;
    },
    contributions,
  };
}

export function defineActionFamily<const Family extends ActionFamilyDefinition>(family: Family): Family {
  return family;
}

export function field<Output>(parse: (value: unknown, label: string) => Output, wire?: WireType): FieldDecoder<Output> {
  return wire === undefined ? { optional: false, parse } : { optional: false, wire, parse };
}

export function optionalField<Output>(decoder: FieldDecoder<Output>): FieldDecoder<Output | undefined, true> {
  return {
    optional: true,
    ...(decoder.wire === undefined ? {} : { wire: decoder.wire }),
    parse(value, label) {
      return value === undefined ? undefined : decoder.parse(value, label);
    },
  };
}
