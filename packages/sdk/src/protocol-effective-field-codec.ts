import type {
  EffectiveField,
  EffectiveFieldSource,
  EffectiveOptionalFieldSource,
  EffectiveStaticDefault,
  OptionalFieldSuggestion,
} from "./projection.js";
import { required } from "./protocol-shape-codec.js";

export function toEffectiveField(value: EffectiveField): Record<string, unknown> {
  return {
    ...value,
    sources: value.sources.map(toEffectiveFieldSource),
    staticDefault: toEffectiveStaticDefault(value.staticDefault),
  };
}

export function fromEffectiveField(value: unknown): EffectiveField {
  const field = value as Record<string, unknown>;
  return {
    ...field,
    sources: (field.sources as readonly unknown[]).map(fromEffectiveFieldSource),
    staticDefault: fromEffectiveStaticDefault(field.staticDefault),
  } as unknown as EffectiveField;
}

export function toOptionalFieldSuggestion(suggestion: OptionalFieldSuggestion): Record<string, unknown> {
  return {
    ...suggestion,
    sources: suggestion.sources.map(({ kind: _kind, ...source }) => source),
  };
}

export function fromOptionalFieldSuggestion(value: unknown): OptionalFieldSuggestion {
  const suggestion = value as Record<string, unknown>;
  return {
    ...suggestion,
    sources: (suggestion.sources as readonly unknown[]).map((source): EffectiveOptionalFieldSource => ({
      kind: "optional",
      ...(source as Omit<EffectiveOptionalFieldSource, "kind">),
    })),
  } as unknown as OptionalFieldSuggestion;
}

function toEffectiveFieldSource(source: EffectiveFieldSource): Record<string, unknown> {
  const { kind, ...fields } = source;
  return { source: { $case: kind, value: fields } };
}

function fromEffectiveFieldSource(value: unknown): EffectiveFieldSource {
  const selected = required(
    (value as { source?: { $case: "template" | "optional"; value: unknown } }).source ?? null,
    "Effective Field source",
  );
  return { kind: selected.$case, ...(selected.value as Record<string, unknown>) } as EffectiveFieldSource;
}

function toEffectiveStaticDefault(value: EffectiveStaticDefault): Record<string, unknown> {
  const { state, candidates } = value;
  if (state === "value") {
    return {
      candidates,
      state: {
        $case: "value",
        value: { value: value.value, sourceTemplateFieldNodeId: value.sourceTemplateFieldNodeId },
      },
    };
  }
  return { candidates, state: { $case: state, value: true } };
}

function fromEffectiveStaticDefault(value: unknown): EffectiveStaticDefault {
  const item = value as Record<string, unknown>;
  const candidates = item.candidates as EffectiveStaticDefault["candidates"];
  const selected = required(
    item.state as { $case: "none" | "value" | "conflict"; value: unknown } | null,
    "Effective Static Default state",
  );
  if (selected.$case === "value") {
    const resolved = selected.value as Readonly<{ value: string; sourceTemplateFieldNodeId: string }>;
    return {
      state: "value",
      candidates,
      value: resolved.value,
      sourceTemplateFieldNodeId: resolved.sourceTemplateFieldNodeId,
    };
  }
  return { state: selected.$case, candidates } as EffectiveStaticDefault;
}
