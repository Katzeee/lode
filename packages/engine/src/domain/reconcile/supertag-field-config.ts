import {
  canonicalJson,
  contributionFactsOfKind,
  DEFAULT_SUPERTAG_FIELD_CONFIG,
  stableStringCompare,
  type ContributionFact,
  type ContributionFactOf,
  type SupertagFieldConfig,
  type FieldVisibility,
} from "../fact/index.js";
import { supertagExtensionGraph, type SupertagExtensionGraph } from "./supertag-extension-graph.js";
import type {
  EffectiveField,
  FieldConfigCandidate,
  FieldInitializationCandidate,
  MaterializedField,
  TemplateField,
} from "./projection-types.js";

export function projectEffectiveFields(
  applications: Readonly<Record<string, readonly string[]>>,
  fieldItems: Readonly<Record<string, readonly TemplateField[]>>,
  extensions: Readonly<Record<string, readonly string[]>>,
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>,
  initializations: ReadonlyMap<string, readonly FieldInitializationCandidate[]> = new Map(),
): Readonly<Record<string, readonly EffectiveField[]>> {
  return effective(applications, fieldItems, supertagExtensionGraph(extensions), materializedFields, initializations);
}

function effective(
  applications: Readonly<Record<string, readonly string[]>>,
  fieldItems: Readonly<Record<string, readonly TemplateField[]>>,
  extensionGraph: SupertagExtensionGraph,
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>,
  initializations: ReadonlyMap<string, readonly FieldInitializationCandidate[]>,
): Readonly<Record<string, readonly EffectiveField[]>> {
  const ownerIds = new Set([...Object.keys(applications), ...Object.keys(materializedFields)]);
  return Object.fromEntries(
    [...ownerIds].sort(stableStringCompare).map((nodeId) => {
      const byField = effectiveItems(applications[nodeId] ?? [], fieldItems, extensionGraph);
      const materialized = new Map((materializedFields[nodeId] ?? []).map((field) => [field.fieldDefinitionId, field]));
      for (const fieldDefinitionId of materialized.keys()) {
        byField.set(fieldDefinitionId, byField.get(fieldDefinitionId) ?? []);
      }
      const fields = [...byField]
        .map(([fieldDefinitionId, items]) =>
          effectiveField(nodeId, fieldDefinitionId, items, extensionGraph, materialized, initializations),
        )
        .filter((field) => field.visibility !== "optional" || materialized.has(field.fieldDefinitionId));
      return [nodeId, fields];
    }),
  );
}

function effectiveItems(
  supertagIds: readonly string[],
  fieldItems: Readonly<Record<string, readonly TemplateField[]>>,
  extensionGraph: SupertagExtensionGraph,
): Map<string, TemplateField[]> {
  const byField = new Map<string, TemplateField[]>();
  for (const appliedSupertagId of supertagIds) {
    for (const supertagId of extensionGraph.lineage(appliedSupertagId)) {
      for (const item of fieldItems[supertagId] ?? []) {
        const items = byField.get(item.fieldDefinitionId) ?? [];
        if (!items.some((candidate) => candidate.fieldNodeId === item.fieldNodeId)) {
          items.push(item);
        }
        byField.set(item.fieldDefinitionId, items);
      }
    }
  }
  return byField;
}

export function configuredFieldItems(
  active: readonly ContributionFact[],
  supertagFields: Readonly<Record<string, readonly TemplateField[]>>,
): Readonly<Record<string, readonly TemplateField[]>> {
  const configurations = contributionFactsOfKind(active, "supertag-field-configure");
  const superseded = new Set(configurations.flatMap((fact) => fact.body.mutation.observedConfigFactIds ?? []));
  return Object.fromEntries(
    Object.entries(supertagFields).map(([supertagId, fields]) => [
      supertagId,
      fields.map((field) => configuredFieldItem(configurations, superseded, field)),
    ]),
  );
}

function configuredFieldItem(
  configurations: readonly ContributionFactOf<"supertag-field-configure">[],
  superseded: ReadonlySet<string>,
  field: TemplateField,
): TemplateField {
  const candidates = configurations.filter((fact) => {
    const mutation = fact.body.mutation;
    return mutation.fieldNodeId === field.fieldNodeId && !superseded.has(fact.id);
  });
  const configCandidates = groupConfigCandidates(
    candidates.map((fact) => ({
      config: fact.body.mutation.config,
      sourceSupertagId: field.supertagId,
      sourceFieldNodeId: field.fieldNodeId,
      contributionId: fact.id,
    })),
  );
  return {
    ...field,
    configCandidates,
    effectiveConfig:
      configCandidates.length === 0
        ? DEFAULT_SUPERTAG_FIELD_CONFIG
        : configCandidates.length === 1
          ? (configCandidates[0]?.config ?? null)
          : null,
  };
}

function effectiveField(
  ownerNodeId: string,
  fieldDefinitionId: string,
  items: readonly TemplateField[],
  extensionGraph: SupertagExtensionGraph,
  materialized: ReadonlyMap<string, MaterializedField>,
  initializations: ReadonlyMap<string, readonly FieldInitializationCandidate[]>,
): EffectiveField {
  const sources = items.filter(
    (item) =>
      !items.some(
        (candidate) =>
          candidate.supertagId !== item.supertagId &&
          extensionGraph.lineage(candidate.supertagId).includes(item.supertagId),
      ),
  );
  const candidates = groupConfigCandidates(sources.flatMap(itemCandidateValues));
  const effectiveConfig = candidates.length === 1 ? (candidates[0]?.config ?? null) : null;
  const initializationCandidates = initializations.get(fieldInitializationKey(ownerNodeId, fieldDefinitionId)) ?? [];
  const initialized = new Map(
    initializationCandidates.map((candidate) => [canonicalJson(candidate.values), candidate.values]),
  );
  return {
    fieldDefinitionId,
    sourceSupertagIds: items.map((item) => item.supertagId),
    sourceFieldNodeIds: items.map((item) => item.fieldNodeId),
    visibility: mostVisible(candidates.map((candidate) => candidate.config.visibility)),
    configCandidates: candidates,
    effectiveConfig,
    initializationCandidates,
    initializedValues: initialized.size === 1 ? ([...initialized.values()][0] ?? null) : null,
    materializedFieldNodeId: materialized.get(fieldDefinitionId)?.fieldNodeId ?? null,
  };
}

function itemCandidateValues(item: TemplateField) {
  const candidates =
    item.configCandidates.length > 0
      ? item.configCandidates
      : [
          {
            config: DEFAULT_SUPERTAG_FIELD_CONFIG,
            sourceSupertagIds: [item.supertagId],
            sourceFieldNodeIds: [item.fieldNodeId],
            contributionIds: [],
          },
        ];
  return candidates.flatMap((candidate) =>
    candidate.sourceSupertagIds.flatMap((sourceSupertagId) =>
      (candidate.contributionIds.length > 0 ? candidate.contributionIds : [null]).map((contributionId) => ({
        config: candidate.config,
        sourceSupertagId,
        sourceFieldNodeId: item.fieldNodeId,
        contributionId,
      })),
    ),
  );
}

export function fieldInitializations(
  active: readonly ContributionFact[],
): ReadonlyMap<string, readonly FieldInitializationCandidate[]> {
  const facts = contributionFactsOfKind(active, "field-initialize");
  const superseded = new Set(facts.flatMap((fact) => fact.body.mutation.observedInitializationFactIds ?? []));
  const values = new Map<string, FieldInitializationCandidate[]>();
  for (const fact of facts) {
    const mutation = fact.body.mutation;
    if (superseded.has(fact.id)) {
      continue;
    }
    const key = fieldInitializationKey(mutation.ownerNodeId, mutation.fieldDefinitionId);
    const candidates = values.get(key) ?? [];
    candidates.push({
      initializationId: fact.id,
      supertagId: mutation.supertagId,
      source: mutation.source,
      values: mutation.values.map((value) =>
        value.kind === "text"
          ? { kind: "text" as const, value: value.value }
          : { kind: "reference" as const, nodeId: value.nodeId },
      ),
    });
    values.set(key, candidates);
  }
  return values;
}

function fieldInitializationKey(ownerNodeId: string, fieldDefinitionId: string): string {
  return canonicalJson([ownerNodeId, fieldDefinitionId]);
}

function groupConfigCandidates(
  values: readonly Readonly<{
    config: SupertagFieldConfig;
    sourceSupertagId: string;
    sourceFieldNodeId: string;
    contributionId: string | null;
  }>[],
): readonly FieldConfigCandidate[] {
  const groups = new Map<string, FieldConfigCandidate>();
  for (const value of values) {
    const key = canonicalJson(value.config);
    const existing = groups.get(key);
    groups.set(key, {
      config: value.config,
      sourceSupertagIds: unique([...(existing?.sourceSupertagIds ?? []), value.sourceSupertagId]),
      sourceFieldNodeIds: unique([...(existing?.sourceFieldNodeIds ?? []), value.sourceFieldNodeId]),
      contributionIds: unique([
        ...(existing?.contributionIds ?? []),
        ...(value.contributionId === null ? [] : [value.contributionId]),
      ]),
    });
  }
  return [...groups.values()].sort((left, right) =>
    stableStringCompare(canonicalJson(left.config), canonicalJson(right.config)),
  );
}

function mostVisible(values: readonly FieldVisibility[]): FieldVisibility {
  return values.includes("pinned") ? "pinned" : values.includes("normal") ? "normal" : "optional";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
