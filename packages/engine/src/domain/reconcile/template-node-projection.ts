import {
  contributionFactsOfKind,
  factObserves,
  stableStringCompare,
  templateInstanceOccurrenceId,
  type ContributionFact,
} from "../fact/index.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import { supertagExtensionGraph } from "./supertag-extension-graph.js";
import type { TemplateNodeInstance, TemplateNodeSource } from "./projection-types.js";
import { listFor } from "./sequence.js";

export type TemplateStructureProjection = Readonly<{
  occurrences: Map<string, MutableOccurrence>;
  childOccurrences: Map<string, string[]>;
  instances: readonly TemplateNodeInstance[];
}>;

export function projectTemplateStructure(
  active: readonly ContributionFact[],
  supertagApplications: Readonly<Record<string, readonly string[]>>,
  supertagTemplateNodes: Readonly<Record<string, readonly string[]>>,
  supertagExtensions: Readonly<Record<string, readonly string[]>>,
  nodes: Map<string, MutableNode>,
  authoredOccurrences: ReadonlyMap<string, MutableOccurrence>,
  authoredChildren: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
): TemplateStructureProjection {
  const occurrences = new Map([...authoredOccurrences].map(([id, occurrence]) => [id, { ...occurrence }]));
  const childOccurrences = new Map(
    [...authoredChildren].map(([parentNodeId, occurrenceIds]) => [parentNodeId, [...occurrenceIds]]),
  );
  const extensionGraph = supertagExtensionGraph(supertagExtensions);
  const currentSources = new Map<string, TemplateNodeSource[]>();
  for (const [ownerNodeId, appliedSupertagIds] of Object.entries(supertagApplications)) {
    for (const appliedSupertagId of appliedSupertagIds) {
      for (const supertagId of extensionGraph.lineage(appliedSupertagId)) {
        for (const templateNodeId of supertagTemplateNodes[supertagId] ?? []) {
          const templateOccurrenceId = activeTemplateOccurrenceId(active, supertagId, templateNodeId);
          if (templateOccurrenceId === null) {
            continue;
          }
          appendSource(currentSources, ownerNodeId, templateNodeId, {
            supertagId,
            appliedSupertagId,
            templateOccurrenceId,
          });
        }
      }
    }
  }
  const detaches = detachments(active);
  const identities = new Set([...currentSources.keys(), ...detaches.keys()]);
  const instances: TemplateNodeInstance[] = [];
  for (const identity of identities) {
    const [ownerNodeId, templateNodeId] = parseIdentity(identity);
    const current = currentSources.get(identity) ?? [];
    const detachFacts = detaches.get(identity) ?? [];
    if (!(ownerNodeId in nodeOwners) || (!nodes.has(templateNodeId) && detachFacts.length === 0)) {
      continue;
    }
    const detached = detachFacts.length > 0;
    const detachment = detached ? detachmentMutation(detachFacts) : null;
    const occurrenceId = detachment?.instanceOccurrenceId ?? templateInstanceOccurrenceId(ownerNodeId, templateNodeId);
    const nodeId = detachment?.instanceNodeId ?? templateNodeId;
    if (detached) {
      const occurrence = occurrences.get(occurrenceId);
      if (occurrence) {
        occurrence.derived = false;
      }
    } else {
      occurrences.set(occurrenceId, {
        occurrenceId,
        nodeId,
        parentNodeId: ownerNodeId,
        derived: true,
      });
      appendUnique(listFor(childOccurrences, ownerNodeId), occurrenceId);
    }
    const sources = current.length > 0 ? current : sourcesFromDetachments(detachFacts);
    instances.push({
      ownerNodeId,
      templateNodeId,
      instanceNodeId: detached ? nodeId : null,
      instanceOccurrenceId: occurrenceId,
      state: detached ? "detached" : "linked",
      sources,
      detachmentContributionIds: detachFacts.map((fact) => fact.id).sort(stableStringCompare),
    });
  }
  return { occurrences, childOccurrences, instances };
}

function detachmentMutation(
  facts: readonly ContributionFact[],
): Extract<ContributionFact["body"]["mutation"], { kind: "template-node-detach" }> {
  for (const fact of facts) {
    if (fact.body.mutation.kind === "template-node-detach") {
      return fact.body.mutation;
    }
  }
  throw new Error("Detached Template content has no detachment Fact");
}

function activeTemplateOccurrenceId(
  active: readonly ContributionFact[],
  supertagId: string,
  templateNodeId: string,
): string | null {
  const removals = contributionFactsOfKind(active, "supertag-template-node-remove");
  let result: string | null = null;
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (
      mutation.kind !== "supertag-template-node-add" ||
      mutation.supertagId !== supertagId ||
      mutation.templateNodeId !== templateNodeId
    ) {
      continue;
    }
    const removed = removals.some((candidate) => {
      const removal = candidate.body.mutation;
      return (
        removal.supertagId === mutation.supertagId &&
        removal.templateNodeId === mutation.templateNodeId &&
        removal.templateOccurrenceId === mutation.templateOccurrenceId &&
        factObserves(candidate, fact)
      );
    });
    if (!removed) {
      result = mutation.templateOccurrenceId;
    }
  }
  return result;
}

export function authoredStructureWithoutProjectedTemplates(
  instances: readonly TemplateNodeInstance[],
  effectiveOccurrences: ReadonlyMap<string, MutableOccurrence>,
  effectiveChildren: ReadonlyMap<string, readonly string[]>,
): Readonly<{
  occurrences: Map<string, MutableOccurrence>;
  childOccurrences: Map<string, string[]>;
}> {
  const occurrences = new Map([...effectiveOccurrences].map(([id, occurrence]) => [id, { ...occurrence }]));
  const childOccurrences = new Map(
    [...effectiveChildren].map(([parentNodeId, occurrenceIds]) => [parentNodeId, [...occurrenceIds]]),
  );
  const occurrenceIds = new Set<string>();
  for (const instance of instances) {
    const occurrence = occurrences.get(instance.instanceOccurrenceId);
    const stillProjected = instance.instanceNodeId === null && occurrence?.nodeId === instance.templateNodeId;
    if (stillProjected) {
      occurrenceIds.add(instance.instanceOccurrenceId);
      occurrences.delete(instance.instanceOccurrenceId);
    }
  }
  for (const [parent, childIds] of childOccurrences) {
    childOccurrences.set(
      parent,
      childIds.filter((occurrenceId) => !occurrenceIds.has(occurrenceId)),
    );
  }
  return { occurrences, childOccurrences };
}

function detachments(active: readonly ContributionFact[]): ReadonlyMap<string, readonly ContributionFact[]> {
  const result = new Map<string, ContributionFact[]>();
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "template-node-detach") {
      continue;
    }
    const key = identity(mutation.ownerNodeId, mutation.templateNodeId);
    const values = result.get(key) ?? [];
    values.push(fact);
    result.set(key, values);
  }
  return result;
}

function sourcesFromDetachments(facts: readonly ContributionFact[]): TemplateNodeSource[] {
  const sources = new Map<string, TemplateNodeSource>();
  for (const fact of facts) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "template-node-detach") {
      continue;
    }
    const supertagIds = mutation.sourceSupertagIds ?? [];
    const applicationSupertagIds = mutation.sourceApplicationSupertagIds ?? [];
    const itemIds = mutation.sourceTemplateOccurrenceIds ?? [];
    itemIds.forEach((templateOccurrenceId, index) => {
      const supertagId = supertagIds[index];
      const appliedSupertagId = applicationSupertagIds[index];
      if (supertagId && appliedSupertagId) {
        sources.set(`${appliedSupertagId}/${templateOccurrenceId}`, {
          supertagId,
          appliedSupertagId,
          templateOccurrenceId,
        });
      }
    });
  }
  return [...sources.values()].sort((left, right) =>
    stableStringCompare(left.templateOccurrenceId, right.templateOccurrenceId),
  );
}

function appendSource(
  sources: Map<string, TemplateNodeSource[]>,
  ownerNodeId: string,
  templateNodeId: string,
  source: TemplateNodeSource,
): void {
  const key = identity(ownerNodeId, templateNodeId);
  const values = sources.get(key) ?? [];
  if (
    !values.some(
      (candidate) =>
        candidate.appliedSupertagId === source.appliedSupertagId &&
        candidate.templateOccurrenceId === source.templateOccurrenceId,
    )
  ) {
    values.push(source);
  }
  sources.set(key, values);
}

function identity(ownerNodeId: string, templateNodeId: string): string {
  return `${encodeURIComponent(ownerNodeId)}/${encodeURIComponent(templateNodeId)}`;
}

function parseIdentity(value: string): readonly [string, string] {
  const [ownerNodeId, templateNodeId] = value.split("/");
  if (!ownerNodeId || !templateNodeId) {
    throw new Error(`Invalid Template Node instance identity: ${value}`);
  }
  return [decodeURIComponent(ownerNodeId), decodeURIComponent(templateNodeId)];
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}
