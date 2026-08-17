import { stableStringCompare } from "../fact/index.js";
import type {
  EffectiveField,
  EffectiveFieldSource,
  EffectiveOptionalFieldSource,
  EffectiveStaticDefault,
  EffectiveTemplateFieldSource,
  MaterializedField,
  OptionalFieldContribution,
  OptionalFieldSuggestion,
  StaticDefaultCandidate,
  SupertagApplication,
  TemplateField,
} from "./projection-types.js";
import { supertagExtensionGraph } from "./supertag-extension-graph.js";

type ContentNode = Readonly<{
  content: readonly Readonly<{ kind: string; value?: string }>[];
}>;

export function projectFieldAvailability(
  applications: Readonly<Record<string, readonly SupertagApplication[]>>,
  templateFields: Readonly<Record<string, readonly TemplateField[]>>,
  optionalContributions: Readonly<Record<string, readonly OptionalFieldContribution[]>>,
  extensions: Readonly<Record<string, readonly string[]>>,
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>,
  nodes: Readonly<Record<string, ContentNode>>,
): Readonly<{
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>;
  optionalFieldSuggestions: Readonly<Record<string, readonly OptionalFieldSuggestion[]>>;
}> {
  const effectiveFields: Record<string, readonly EffectiveField[]> = {};
  const optionalFieldSuggestions: Record<string, readonly OptionalFieldSuggestion[]> = {};
  for (const [ownerNodeId, ownerApplications] of Object.entries(applications).sort(([left], [right]) =>
    stableStringCompare(left, right),
  )) {
    const byDefinition = contributionsByDefinition(
      ownerApplications,
      templateFields,
      optionalContributions,
      extensions,
    );
    const materialized = new Map(
      (materializedFields[ownerNodeId] ?? []).map((field) => [field.fieldDefinitionId, field.fieldNodeId]),
    );
    effectiveFields[ownerNodeId] = [...byDefinition]
      .flatMap(([fieldDefinitionId, item]): EffectiveField[] =>
        item.templateSources.length === 0
          ? []
          : [
              {
                ownerNodeId,
                fieldDefinitionId,
                sources: [...item.templateSources, ...item.optionalSources],
                staticDefault: effectiveStaticDefault(item.templateSources, nodes),
                visibility: item.templateSources.some((source) => source.visibility === "pinned") ? "pinned" : "normal",
                visibilityConflicted: item.visibilityConflicted,
                materializedFieldNodeId: materialized.get(fieldDefinitionId) ?? null,
              },
            ],
      )
      .sort(
        (left, right) =>
          visibilityRank(left.visibility) - visibilityRank(right.visibility) ||
          stableStringCompare(left.fieldDefinitionId, right.fieldDefinitionId),
      );
    optionalFieldSuggestions[ownerNodeId] = [...byDefinition]
      .flatMap(([fieldDefinitionId, item]): OptionalFieldSuggestion[] =>
        item.templateSources.length === 0 && item.optionalSources.length > 0 && !materialized.has(fieldDefinitionId)
          ? [{ ownerNodeId, fieldDefinitionId, sources: item.optionalSources }]
          : [],
      )
      .sort((left, right) => stableStringCompare(left.fieldDefinitionId, right.fieldDefinitionId));
  }
  return { effectiveFields, optionalFieldSuggestions };
}

function contributionsByDefinition(
  applications: readonly SupertagApplication[],
  templateFields: Readonly<Record<string, readonly TemplateField[]>>,
  optionalContributions: Readonly<Record<string, readonly OptionalFieldContribution[]>>,
  extensions: Readonly<Record<string, readonly string[]>>,
): Map<string, EffectiveFieldAccumulator> {
  const values = new Map<string, EffectiveFieldAccumulator>();
  const extensionGraph = supertagExtensionGraph(extensions);
  for (const application of applications) {
    for (const extensionPath of extensionGraph.paths(application.supertagId)) {
      const sourceSupertagId = extensionPath.at(-1);
      if (sourceSupertagId === undefined) {
        continue;
      }
      for (const field of templateFields[sourceSupertagId] ?? []) {
        const item = accumulator(values, field.fieldDefinitionId);
        appendSource(item.templateSources, {
          kind: "template",
          applicationNodeId: application.applicationNodeId,
          appliedSupertagId: application.supertagId,
          sourceSupertagId,
          extensionPath,
          templateFieldNodeId: field.templateFieldNodeId,
          staticDefaultValueNodeId: field.staticDefaultValueNodeId,
          visibility: field.visibility,
        });
        item.visibilityConflicted ||= field.visibilityConflicted;
      }
      for (const field of optionalContributions[sourceSupertagId] ?? []) {
        appendSource(accumulator(values, field.fieldDefinitionId).optionalSources, {
          kind: "optional",
          applicationNodeId: application.applicationNodeId,
          appliedSupertagId: application.supertagId,
          sourceSupertagId,
          extensionPath,
          optionalContributionNodeId: field.contributionNodeId,
        });
      }
    }
  }
  return values;
}

type EffectiveFieldAccumulator = {
  templateSources: EffectiveTemplateFieldSource[];
  optionalSources: EffectiveOptionalFieldSource[];
  visibilityConflicted: boolean;
};

function accumulator(values: Map<string, EffectiveFieldAccumulator>, fieldDefinitionId: string) {
  const value = values.get(fieldDefinitionId) ?? {
    templateSources: [],
    optionalSources: [],
    visibilityConflicted: false,
  };
  values.set(fieldDefinitionId, value);
  return value;
}

function appendSource<Source extends EffectiveFieldSource>(values: Source[], source: Source): void {
  const identity = sourceIdentity(source);
  if (!values.some((candidate) => sourceIdentity(candidate) === identity)) {
    values.push(source);
  }
}

function sourceIdentity(source: EffectiveFieldSource): string {
  const contributionId = source.kind === "template" ? source.templateFieldNodeId : source.optionalContributionNodeId;
  return [source.kind, source.applicationNodeId, source.extensionPath.join("\u0000"), contributionId].join("\u0001");
}

function effectiveStaticDefault(
  sources: readonly EffectiveTemplateFieldSource[],
  nodes: Readonly<Record<string, ContentNode>>,
): EffectiveStaticDefault {
  const authored = sources.flatMap((source) => {
    const value = textContent(nodes[source.staticDefaultValueNodeId]);
    return value.length === 0 ? [] : [{ source, value }];
  });
  const unshadowed = authored.filter(
    ({ source }) =>
      !authored.some(
        ({ source: candidate }) =>
          candidate.applicationNodeId === source.applicationNodeId &&
          candidate.extensionPath.length < source.extensionPath.length &&
          isPathPrefix(candidate.extensionPath, source.extensionPath),
      ),
  );
  const byValue = new Map<string, string[]>();
  for (const { source, value } of unshadowed) {
    const sourceIds = byValue.get(value) ?? [];
    if (!sourceIds.includes(source.templateFieldNodeId)) {
      sourceIds.push(source.templateFieldNodeId);
      sourceIds.sort(stableStringCompare);
    }
    byValue.set(value, sourceIds);
  }
  const candidates: StaticDefaultCandidate[] = [...byValue]
    .sort(([left], [right]) => stableStringCompare(left, right))
    .map(([value, sourceTemplateFieldNodeIds]) => ({ value, sourceTemplateFieldNodeIds }));
  if (candidates.length === 0) {
    return { state: "none", candidates: [] };
  }
  if (candidates.length > 1) {
    return { state: "conflict", candidates };
  }
  const candidate = candidates[0];
  const sourceTemplateFieldNodeId = candidate?.sourceTemplateFieldNodeIds[0];
  if (candidate === undefined || sourceTemplateFieldNodeId === undefined) {
    return { state: "none", candidates: [] };
  }
  return { state: "value", value: candidate.value, sourceTemplateFieldNodeId, candidates };
}

function textContent(node: ContentNode | undefined): string {
  if (node === undefined || node.content.some((item) => item.kind !== "text")) {
    return "";
  }
  return node.content.map((item) => item.value ?? "").join("");
}

function isPathPrefix(prefix: readonly string[], value: readonly string[]): boolean {
  return prefix.every((item, index) => value[index] === item);
}

function visibilityRank(visibility: "normal" | "pinned"): number {
  return visibility === "pinned" ? 0 : 1;
}
