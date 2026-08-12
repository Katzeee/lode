import {
  canonicalJson,
  DEFAULT_FIELD_TEMPLATE_CONFIG,
  stableStringCompare,
  type ContributionFact,
  type FieldTemplateConfig,
  type FieldVisibility,
} from "../fact/index.js";
import { schemaExtensionGraph, type SchemaExtensionGraph } from "./schema-extension-graph.js";
import type {
  EffectiveField,
  FieldConfigCandidate,
  FieldInitializationCandidate,
  MaterializedField,
  SchemaFieldItem,
} from "./projection-types.js";

export function projectEffectiveFields(
  applications: Readonly<Record<string, readonly string[]>>,
  fieldItems: Readonly<Record<string, readonly SchemaFieldItem[]>>,
  extensions: Readonly<Record<string, readonly string[]>>,
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>,
  initializations: ReadonlyMap<string, readonly FieldInitializationCandidate[]> = new Map(),
): Readonly<Record<string, readonly EffectiveField[]>> {
  return effective(
    applications,
    fieldItems,
    schemaExtensionGraph(extensions),
    materializedFields,
    initializations,
  );
}

function effective(
  applications: Readonly<Record<string, readonly string[]>>,
  fieldItems: Readonly<Record<string, readonly SchemaFieldItem[]>>,
  extensionGraph: SchemaExtensionGraph,
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>,
  initializations: ReadonlyMap<string, readonly FieldInitializationCandidate[]>,
): Readonly<Record<string, readonly EffectiveField[]>> {
  const ownerIds = new Set([...Object.keys(applications), ...Object.keys(materializedFields)]);
  return Object.fromEntries(
    [...ownerIds].sort(stableStringCompare).map((nodeId) => {
      const byField = effectiveItems(applications[nodeId] ?? [], fieldItems, extensionGraph);
      const materialized = new Map(
        (materializedFields[nodeId] ?? []).map((field) => [field.fieldDefinitionId, field]),
      );
      for (const fieldDefinitionId of materialized.keys()) {
        byField.set(fieldDefinitionId, byField.get(fieldDefinitionId) ?? []);
      }
      const fields = [...byField]
        .map(([fieldDefinitionId, items]) =>
          effectiveField(
            nodeId,
            fieldDefinitionId,
            items,
            extensionGraph,
            materialized,
            initializations,
          ),
        )
        .filter(
          (field) => field.visibility !== "optional" || materialized.has(field.fieldDefinitionId),
        );
      return [nodeId, fields];
    }),
  );
}

function effectiveItems(
  schemaIds: readonly string[],
  fieldItems: Readonly<Record<string, readonly SchemaFieldItem[]>>,
  extensionGraph: SchemaExtensionGraph,
): Map<string, SchemaFieldItem[]> {
  const byField = new Map<string, SchemaFieldItem[]>();
  for (const appliedSchemaId of schemaIds) {
    for (const schemaId of extensionGraph.lineage(appliedSchemaId)) {
      for (const item of fieldItems[schemaId] ?? []) {
        const items = byField.get(item.fieldDefinitionId) ?? [];
        if (!items.some((candidate) => candidate.templateItemId === item.templateItemId)) {
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
  schemaFields: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly SchemaFieldItem[]>> {
  const configurations = active.filter(
    (fact) => fact.body.mutation.kind === "schema-field-configure",
  );
  const superseded = new Set(
    configurations.flatMap((fact) => {
      const mutation = fact.body.mutation;
      return mutation.kind === "schema-field-configure"
        ? (mutation.observedConfigFactIds ?? [])
        : [];
    }),
  );
  return Object.fromEntries(
    Object.entries(schemaFields).map(([schemaId, fieldDefinitionIds]) => [
      schemaId,
      fieldDefinitionIds.map((fieldDefinitionId) =>
        configuredFieldItem(configurations, superseded, schemaId, fieldDefinitionId),
      ),
    ]),
  );
}

function configuredFieldItem(
  configurations: readonly ContributionFact[],
  superseded: ReadonlySet<string>,
  schemaId: string,
  fieldDefinitionId: string,
): SchemaFieldItem {
  const templateItemId = fieldTemplateItemId(schemaId, fieldDefinitionId);
  const candidates = configurations.filter((fact) => {
    const mutation = fact.body.mutation;
    return (
      mutation.kind === "schema-field-configure" &&
      mutation.schemaId === schemaId &&
      mutation.fieldDefinitionId === fieldDefinitionId &&
      !superseded.has(fact.id)
    );
  });
  const configCandidates = groupConfigCandidates(
    candidates.map((fact) => ({
      config:
        fact.body.mutation.kind === "schema-field-configure"
          ? fact.body.mutation.config
          : DEFAULT_FIELD_TEMPLATE_CONFIG,
      sourceSchemaId: schemaId,
      sourceTemplateItemId: templateItemId,
      contributionId: fact.id,
    })),
  );
  return {
    templateItemId,
    schemaId,
    fieldDefinitionId,
    configCandidates,
    effectiveConfig:
      configCandidates.length === 0
        ? DEFAULT_FIELD_TEMPLATE_CONFIG
        : configCandidates.length === 1
          ? (configCandidates[0]?.config ?? null)
          : null,
  };
}

function effectiveField(
  ownerNodeId: string,
  fieldDefinitionId: string,
  items: readonly SchemaFieldItem[],
  extensionGraph: SchemaExtensionGraph,
  materialized: ReadonlyMap<string, MaterializedField>,
  initializations: ReadonlyMap<string, readonly FieldInitializationCandidate[]>,
): EffectiveField {
  const sources = items.filter(
    (item) =>
      !items.some(
        (candidate) =>
          candidate.schemaId !== item.schemaId &&
          extensionGraph.lineage(candidate.schemaId).includes(item.schemaId),
      ),
  );
  const candidates = groupConfigCandidates(sources.flatMap(itemCandidateValues));
  const effectiveConfig = candidates.length === 1 ? (candidates[0]?.config ?? null) : null;
  const initializationCandidates =
    initializations.get(fieldInitializationKey(ownerNodeId, fieldDefinitionId)) ?? [];
  const initialized = new Map(
    initializationCandidates.map((candidate) => [
      canonicalJson(candidate.values),
      candidate.values,
    ]),
  );
  return {
    fieldDefinitionId,
    sourceSchemaIds: items.map((item) => item.schemaId),
    sourceTemplateItemIds: items.map((item) => item.templateItemId),
    visibility: mostVisible(candidates.map((candidate) => candidate.config.visibility)),
    configCandidates: candidates,
    effectiveConfig,
    initializationCandidates,
    initializedValues: initialized.size === 1 ? ([...initialized.values()][0] ?? null) : null,
    materializedFieldNodeId: materialized.get(fieldDefinitionId)?.fieldNodeId ?? null,
  };
}

function itemCandidateValues(item: SchemaFieldItem) {
  const candidates =
    item.configCandidates.length > 0
      ? item.configCandidates
      : [
          {
            config: DEFAULT_FIELD_TEMPLATE_CONFIG,
            sourceSchemaIds: [item.schemaId],
            sourceTemplateItemIds: [item.templateItemId],
            contributionIds: [],
          },
        ];
  return candidates.flatMap((candidate) =>
    candidate.sourceSchemaIds.flatMap((sourceSchemaId) =>
      (candidate.contributionIds.length > 0 ? candidate.contributionIds : [null]).map(
        (contributionId) => ({
          config: candidate.config,
          sourceSchemaId,
          sourceTemplateItemId: item.templateItemId,
          contributionId,
        }),
      ),
    ),
  );
}

export function fieldInitializations(
  active: readonly ContributionFact[],
): ReadonlyMap<string, readonly FieldInitializationCandidate[]> {
  const facts = active.filter((fact) => fact.body.mutation.kind === "field-initialize");
  const superseded = new Set(
    facts.flatMap((fact) => {
      const mutation = fact.body.mutation;
      return mutation.kind === "field-initialize"
        ? (mutation.observedInitializationFactIds ?? [])
        : [];
    }),
  );
  const values = new Map<string, FieldInitializationCandidate[]>();
  for (const fact of facts) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "field-initialize" || superseded.has(fact.id)) {
      continue;
    }
    const key = fieldInitializationKey(mutation.ownerNodeId, mutation.fieldDefinitionId);
    const candidates = values.get(key) ?? [];
    candidates.push({
      initializationId: fact.id,
      schemaId: mutation.schemaId,
      source: mutation.source,
      values: mutation.values,
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
    config: FieldTemplateConfig;
    sourceSchemaId: string;
    sourceTemplateItemId: string;
    contributionId: string | null;
  }>[],
): readonly FieldConfigCandidate[] {
  const groups = new Map<string, FieldConfigCandidate>();
  for (const value of values) {
    const key = canonicalJson(value.config);
    const existing = groups.get(key);
    groups.set(key, {
      config: value.config,
      sourceSchemaIds: unique([...(existing?.sourceSchemaIds ?? []), value.sourceSchemaId]),
      sourceTemplateItemIds: unique([
        ...(existing?.sourceTemplateItemIds ?? []),
        value.sourceTemplateItemId,
      ]),
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

export function fieldTemplateItemId(schemaId: string, fieldDefinitionId: string): string {
  return `field-template:v1:${encodeURIComponent(schemaId)}:${encodeURIComponent(fieldDefinitionId)}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
