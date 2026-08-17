import { array, exact, nonempty, object, stringValue } from "../../shape-validation/index.js";
import type {
  EffectiveField,
  EffectiveFieldSource,
  EffectiveOptionalFieldSource,
  EffectiveStaticDefault,
  OptionalFieldSuggestion,
} from "./effective-field-types.js";

export function parseEffectiveField(value: unknown): EffectiveField {
  const item = object(value, "Effective Field");
  exact(
    item,
    [
      "ownerNodeId",
      "fieldDefinitionId",
      "sources",
      "staticDefault",
      "visibility",
      "materializedFieldNodeId",
      "visibilityConflicted",
    ],
    "Effective Field",
  );
  if (item.visibility !== "normal" && item.visibility !== "pinned") {
    throw new Error("Effective Field visibility is invalid");
  }
  return {
    ownerNodeId: identity(item.ownerNodeId),
    fieldDefinitionId: identity(item.fieldDefinitionId),
    sources: array(item.sources, "Effective Field sources", effectiveFieldSource),
    staticDefault: effectiveStaticDefault(item.staticDefault),
    visibility: item.visibility,
    visibilityConflicted: booleanValue(item.visibilityConflicted, "Effective Field visibility conflict"),
    materializedFieldNodeId: item.materializedFieldNodeId === null ? null : identity(item.materializedFieldNodeId),
  };
}

export function parseOptionalFieldSuggestion(value: unknown): OptionalFieldSuggestion {
  const item = object(value, "Optional Field Suggestion");
  exact(item, ["ownerNodeId", "fieldDefinitionId", "sources"], "Optional Field Suggestion");
  return {
    ownerNodeId: identity(item.ownerNodeId),
    fieldDefinitionId: identity(item.fieldDefinitionId),
    sources: array(item.sources, "Optional Field sources", (sourceValue) => {
      const source = effectiveFieldSource(sourceValue);
      if (source.kind !== "optional") {
        throw new Error("Optional Field source is not optional");
      }
      return source;
    }),
  };
}

function effectiveFieldSource(value: unknown): EffectiveFieldSource {
  const item = object(value, "Effective Field source");
  const appliedSupertagId = identity(item.appliedSupertagId);
  const sourceSupertagId = identity(item.sourceSupertagId);
  const extensionPath = identities(item.extensionPath);
  if (extensionPath[0] !== appliedSupertagId || extensionPath.at(-1) !== sourceSupertagId) {
    throw new Error("Effective Field source path endpoints are invalid");
  }
  const path = {
    applicationNodeId: identity(item.applicationNodeId),
    appliedSupertagId,
    sourceSupertagId,
    extensionPath,
  };
  if (item.kind === "template") {
    exact(
      item,
      [
        "kind",
        "applicationNodeId",
        "appliedSupertagId",
        "sourceSupertagId",
        "extensionPath",
        "templateFieldNodeId",
        "staticDefaultValueNodeId",
        "visibility",
      ],
      "Template Field source",
    );
    if (item.visibility !== "normal" && item.visibility !== "pinned") {
      throw new Error("Template Field source visibility is invalid");
    }
    return {
      kind: "template",
      ...path,
      templateFieldNodeId: identity(item.templateFieldNodeId),
      staticDefaultValueNodeId: identity(item.staticDefaultValueNodeId),
      visibility: item.visibility,
    };
  }
  if (item.kind === "optional") {
    exact(
      item,
      [
        "kind",
        "applicationNodeId",
        "appliedSupertagId",
        "sourceSupertagId",
        "extensionPath",
        "optionalContributionNodeId",
      ],
      "Optional Field source",
    );
    return {
      kind: "optional",
      ...path,
      optionalContributionNodeId: identity(item.optionalContributionNodeId),
    } satisfies EffectiveOptionalFieldSource;
  }
  throw new Error("Effective Field source kind is invalid");
}

function effectiveStaticDefault(value: unknown): EffectiveStaticDefault {
  const item = object(value, "Effective Static Default");
  const candidates = array(item.candidates, "Static Default candidates", (candidateValue) => {
    const candidate = object(candidateValue, "Static Default candidate");
    exact(candidate, ["value", "sourceTemplateFieldNodeIds"], "Static Default candidate");
    return {
      value: stringValue(candidate.value, "Static Default value"),
      sourceTemplateFieldNodeIds: identities(candidate.sourceTemplateFieldNodeIds),
    };
  });
  if (item.state === "none") {
    exact(item, ["state", "candidates"], "Empty Static Default");
    if (candidates.length !== 0) {
      throw new Error("Empty Static Default has candidates");
    }
    return { state: "none", candidates: [] };
  }
  if (item.state === "conflict") {
    exact(item, ["state", "candidates"], "Conflicted Static Default");
    if (candidates.length < 2) {
      throw new Error("Conflicted Static Default needs multiple candidates");
    }
    return { state: "conflict", candidates };
  }
  if (item.state === "value") {
    exact(item, ["state", "value", "sourceTemplateFieldNodeId", "candidates"], "Resolved Static Default");
    const sourceTemplateFieldNodeId = identity(item.sourceTemplateFieldNodeId);
    const candidate = candidates[0];
    if (
      candidates.length !== 1 ||
      candidate?.value !== item.value ||
      !candidate?.sourceTemplateFieldNodeIds.includes(sourceTemplateFieldNodeId)
    ) {
      throw new Error("Resolved Static Default does not match its candidate");
    }
    return {
      state: "value",
      value: stringValue(item.value, "Static Default value"),
      sourceTemplateFieldNodeId,
      candidates,
    };
  }
  throw new Error("Effective Static Default state is invalid");
}

function identities(value: unknown): string[] {
  return array(value, "Identities", identity);
}

function identity(value: unknown): string {
  return nonempty(value, "Identity");
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
