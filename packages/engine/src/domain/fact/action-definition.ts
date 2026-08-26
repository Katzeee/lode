import { object } from "../../decoding/index.js";
import type { SemanticContribution } from "./action-semantics/types.js";

export type ActionAdmission = "proposable" | "direct-only" | "terminal";

export type FieldDecoder<Output, Optional extends boolean = false> = Readonly<{
  optional: Optional;
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

export type ActionDefinition<
  Kind extends string = string,
  Admission extends ActionAdmission = ActionAdmission,
  Fields extends ActionFields = ActionFields,
  Contributions extends readonly SemanticContribution[] = readonly SemanticContribution[],
> = Readonly<{
  kind: Kind;
  admission: Admission;
  fields: Fields;
  parse(value: unknown): DecodedAction<Kind, Fields>;
  contributions(action: DecodedAction<Kind, Fields>): Contributions;
}>;

export type AnyActionDefinition = ActionDefinition<
  string,
  ActionAdmission,
  ActionFields,
  readonly SemanticContribution[]
>;
export type ActionOf<Definition extends AnyActionDefinition> = ReturnType<Definition["parse"]>;
export type ActionContributionsOf<Definition extends AnyActionDefinition> = ReturnType<Definition["contributions"]>;
export type ActionFamilyDefinition = Readonly<Record<string, AnyActionDefinition>>;

export function defineAction<
  const Kind extends string,
  const Admission extends ActionAdmission,
  const Fields extends ActionFields,
  const Contributions extends readonly SemanticContribution[],
>(
  kind: Kind,
  admission: Admission,
  fields: Fields,
  contributions: (action: DecodedAction<Kind, Fields>) => Contributions,
): ActionDefinition<Kind, Admission, Fields, Contributions> {
  return {
    kind,
    admission,
    fields,
    parse(value: unknown) {
      const record = object(value, `${kind} Authored Action`);
      if (record.kind !== kind) {
        throw new Error(`Expected ${kind} Authored Action`);
      }
      const allowedKeys = new Set(["kind", ...Object.keys(fields)]);
      const unknownKey = Object.keys(record).find((name) => !allowedKeys.has(name));
      if (unknownKey) {
        throw new Error(`${kind} Authored Action contains unknown field: ${unknownKey}`);
      }
      for (const [name, decoder] of Object.entries(fields)) {
        if (!(name in record) && !decoder.optional) {
          throw new Error(`${kind} Authored Action is missing ${name}`);
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

export function field<Output>(parse: (value: unknown, label: string) => Output): FieldDecoder<Output> {
  return { optional: false, parse };
}

export function optionalField<Output>(decoder: FieldDecoder<Output>): FieldDecoder<Output | undefined, true> {
  return {
    optional: true,
    parse(value, label) {
      return value === undefined ? undefined : decoder.parse(value, label);
    },
  };
}
