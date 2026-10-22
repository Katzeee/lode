import { ShapeValidationError } from "../../decoding/index.js";
import type { GraphAction, WireType } from "../fact/index.js";

export type EditField<Output, Optional extends boolean = false> = Readonly<{
  label: string;
  optional: Optional;
  wire: WireType;
  parse(value: unknown, label: string): Output;
}>;

type AnyEditField = EditField<unknown, boolean>;
type EditFields = Readonly<Record<string, AnyEditField>>;

type OutputOf<Field extends AnyEditField> = Field extends EditField<infer Output, boolean> ? Output : never;
type RequiredFieldNames<Fields extends EditFields> = {
  [Name in keyof Fields]: Fields[Name]["optional"] extends true ? never : Name;
}[keyof Fields];
type OptionalFieldNames<Fields extends EditFields> = Exclude<keyof Fields, RequiredFieldNames<Fields>>;

type DecodedEditFields<Fields extends EditFields> = Readonly<
  { [Name in RequiredFieldNames<Fields>]: OutputOf<Fields[Name]> } & {
    [Name in OptionalFieldNames<Fields>]?: Exclude<OutputOf<Fields[Name]>, undefined>;
  }
>;

export type DecodedEdit<Kind extends string, Fields extends EditFields> = Readonly<{ kind: Kind }> &
  DecodedEditFields<Fields>;

type EditDefinition<Kind extends string = string, Fields extends EditFields = EditFields> = Readonly<{
  kind: Kind;
  fields: Fields;
  parse(edit: Readonly<Record<string, unknown>>): DecodedEdit<Kind, Fields>;
  /**
   * Pure expansion of the decoded edit into its Fact Actions, for edits whose
   * plan is a function of the edit alone. Edits whose expansion reads the
   * current Projection plan imperatively in the workspace planning layer.
   */
  plan?(edit: DecodedEdit<Kind, Fields>): readonly [GraphAction, ...GraphAction[]];
}>;

type EditPlan<Kind extends string, Fields extends EditFields> = (
  edit: DecodedEdit<Kind, Fields>,
) => readonly [GraphAction, ...GraphAction[]];

type EditOptions<Kind extends string, Fields extends EditFields> = Readonly<{
  refine?: (edit: DecodedEdit<Kind, Fields>) => DecodedEdit<Kind, Fields>;
  plan?: EditPlan<Kind, Fields>;
}>;

/** A definition whose expansion is declared on it; the planning layer dispatches on this shape. */
export type PlannedEditDefinition<
  Kind extends string = string,
  Fields extends EditFields = EditFields,
> = EditDefinition<Kind, Fields> & Readonly<{ plan: EditPlan<Kind, Fields> }>;

export type AnyEditDefinition = EditDefinition;
export type EditOf<Definition extends AnyEditDefinition> = ReturnType<Definition["parse"]>;
export type EditFamilyDefinition = Readonly<Record<string, AnyEditDefinition>>;

export function defineEdit<const Kind extends string, const Fields extends EditFields>(
  kind: Kind,
  fields: Fields,
  options: EditOptions<Kind, Fields> & Readonly<{ plan: EditPlan<Kind, Fields> }>,
): PlannedEditDefinition<Kind, Fields>;
export function defineEdit<const Kind extends string, const Fields extends EditFields>(
  kind: Kind,
  fields: Fields,
  options?: EditOptions<Kind, Fields>,
): EditDefinition<Kind, Fields>;
export function defineEdit<const Kind extends string, const Fields extends EditFields>(
  kind: Kind,
  fields: Fields,
  options: EditOptions<Kind, Fields> = {},
): EditDefinition<Kind, Fields> {
  const { refine, plan } = options;
  return {
    kind,
    fields,
    ...(plan === undefined ? {} : { plan }),
    parse(edit) {
      exactEditKeys(edit, fields);
      const decoded = { kind, ...decodeEditFields(edit, fields) } as DecodedEdit<Kind, Fields>;
      return refine === undefined ? decoded : refine(decoded);
    },
  };
}

/**
 * Escape hatch for edits whose evidence is validated as one Fact Action shape (via
 * `parseAuthoredAction`) instead of field by field. The declared fields still carry the decoded
 * type; the custom parse owns the runtime checks and must produce exactly that shape.
 */
export function defineEditWithCustomParse<const Kind extends string, const Fields extends EditFields>(
  kind: Kind,
  fields: Fields,
  parse: (edit: Readonly<Record<string, unknown>>) => DecodedEdit<Kind, Fields>,
  plan: EditPlan<Kind, Fields>,
): PlannedEditDefinition<Kind, Fields>;
export function defineEditWithCustomParse<const Kind extends string, const Fields extends EditFields>(
  kind: Kind,
  fields: Fields,
  parse: (edit: Readonly<Record<string, unknown>>) => DecodedEdit<Kind, Fields>,
): EditDefinition<Kind, Fields>;
export function defineEditWithCustomParse<const Kind extends string, const Fields extends EditFields>(
  kind: Kind,
  fields: Fields,
  parse: (edit: Readonly<Record<string, unknown>>) => DecodedEdit<Kind, Fields>,
  plan?: EditPlan<Kind, Fields>,
): EditDefinition<Kind, Fields> {
  return {
    kind,
    fields,
    ...(plan === undefined ? {} : { plan }),
    parse(edit) {
      exactEditKeys(edit, fields);
      return parse(edit);
    },
  };
}

export function defineEditFamily<const Family extends EditFamilyDefinition>(family: Family): Family {
  return family;
}

export function editField<Output>(
  label: string,
  wire: WireType,
  parse: (value: unknown, label: string) => Output,
): EditField<Output> {
  return { label, optional: false, wire, parse };
}

export function optionalEditField<Output>(field: EditField<Output>): EditField<Output | undefined, true> {
  return {
    label: field.label,
    optional: true,
    wire: field.wire,
    parse(value, label) {
      return value === undefined ? undefined : field.parse(value, label);
    },
  };
}

function exactEditKeys(edit: Readonly<Record<string, unknown>>, fields: EditFields): void {
  const allowed = new Set(["kind", ...Object.keys(fields)]);
  const unknown = Object.keys(edit).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    throw new ShapeValidationError(`Unknown input field: ${unknown}`);
  }
}

function decodeEditFields<Fields extends EditFields>(
  edit: Readonly<Record<string, unknown>>,
  fields: Fields,
): DecodedEditFields<Fields> {
  const decoded: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    const value = edit[name];
    if (field.optional && value === undefined) {
      continue;
    }
    decoded[name] = field.parse(value, field.label);
  }
  return decoded as DecodedEditFields<Fields>;
}
