import type {
  EffectiveFieldSource as ProtocolEffectiveFieldSource,
  EffectiveStaticDefault as ProtocolEffectiveStaticDefault,
} from "@lode/protocol/proto";
import type { TemplateFieldVisibility as ProtocolTemplateFieldVisibility } from "@lode/protocol/proto";

import type {
  EffectiveField,
  EffectiveFieldSource,
  EffectiveOptionalFieldSource,
  EffectiveStaticDefault,
  OptionalFieldSuggestion,
} from "./projection.js";
import { selectedCase, unsupportedProtocolCase, unsupportedProtocolValue } from "./protocol-decoding.js";
import type { ProtocolDto } from "./protocol-dto.js";
import { templateFieldVisibility } from "./protocol-enums/model.js";

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
  switch (kind) {
    case "template":
      return { source: { case: "template", value: fields } };
    case "optional":
      return { source: { case: "optional", value: fields } };
    default:
      return unsupportedProtocolValue(kind, "Effective Field source kind");
  }
}

function fromEffectiveFieldSource(value: unknown): EffectiveFieldSource {
  const selected = selectedCase((value as ProtocolDto<ProtocolEffectiveFieldSource>).source, "Effective Field source");
  switch (selected.case) {
    case "template":
      return {
        kind: "template",
        ...selected.value,
        visibility: decodeTemplateFieldVisibility(selected.value.visibility),
      };
    case "optional":
      return { kind: "optional", ...selected.value };
    default:
      return unsupportedProtocolCase(selected, "Effective Field source");
  }
}

function decodeTemplateFieldVisibility(
  value: unknown,
): Extract<EffectiveFieldSource, { kind: "template" }>["visibility"] {
  if (typeof value === "string") {
    if (templateFieldVisibility.values.includes(value as "normal" | "pinned")) {
      return value as "normal" | "pinned";
    }
    throw new Error(`Template Field visibility is invalid: ${value}`);
  }
  return templateFieldVisibility.decode(value as ProtocolTemplateFieldVisibility);
}

function toEffectiveStaticDefault(value: EffectiveStaticDefault): Record<string, unknown> {
  const { state, candidates } = value;
  switch (state) {
    case "none":
      return { candidates, state: { case: "none", value: true } };
    case "value":
      return {
        candidates,
        state: {
          case: "value",
          value: { value: value.value, sourceTemplateFieldNodeId: value.sourceTemplateFieldNodeId },
        },
      };
    case "conflict":
      return { candidates, state: { case: "conflict", value: true } };
    default:
      return unsupportedProtocolValue(state, "Effective Static Default state");
  }
}

function fromEffectiveStaticDefault(value: unknown): EffectiveStaticDefault {
  const item = value as ProtocolDto<ProtocolEffectiveStaticDefault>;
  const candidates = item.candidates;
  const selected = selectedCase(item.state, "Effective Static Default state");
  switch (selected.case) {
    case "none":
      if (candidates.length > 0) {
        throw new Error("Effective Static Default none state has candidates");
      }
      return { state: "none", candidates: [] };
    case "value":
      return {
        state: "value",
        candidates,
        value: selected.value.value,
        sourceTemplateFieldNodeId: selected.value.sourceTemplateFieldNodeId,
      };
    case "conflict":
      return { state: "conflict", candidates };
    default:
      return unsupportedProtocolCase(selected, "Effective Static Default state");
  }
}
