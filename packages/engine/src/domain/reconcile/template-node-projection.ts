import {
  stableStringCompare,
  templateInstanceOccurrenceId,
  type ContributionFact,
} from "../fact/index.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import { schemaExtensionGraph } from "./schema-extension-graph.js";
import type { TemplateNodeInstance, TemplateNodeSource } from "./projection-types.js";
import { listFor } from "./sequence.js";

export function projectTemplateNodeInstances(
  active: readonly ContributionFact[],
  schemaApplications: Readonly<Record<string, readonly string[]>>,
  schemaTemplateNodes: Readonly<Record<string, readonly string[]>>,
  schemaExtensions: Readonly<Record<string, readonly string[]>>,
  nodes: Map<string, MutableNode>,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
): readonly TemplateNodeInstance[] {
  const extensionGraph = schemaExtensionGraph(schemaExtensions);
  const currentSources = new Map<string, TemplateNodeSource[]>();
  for (const [ownerNodeId, appliedSchemaIds] of Object.entries(schemaApplications)) {
    for (const appliedSchemaId of appliedSchemaIds) {
      for (const schemaId of extensionGraph.lineage(appliedSchemaId)) {
        for (const templateNodeId of schemaTemplateNodes[schemaId] ?? []) {
          const templateOccurrenceId = activeTemplateOccurrenceId(active, schemaId, templateNodeId);
          if (templateOccurrenceId === null) {
            continue;
          }
          appendSource(currentSources, ownerNodeId, templateNodeId, {
            schemaId,
            appliedSchemaId,
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
    const occurrenceId =
      detachment?.instanceOccurrenceId ?? templateInstanceOccurrenceId(ownerNodeId, templateNodeId);
    const nodeId = detachment?.instanceNodeId ?? templateNodeId;
    if (detached) {
      const occurrence = occurrences.get(occurrenceId);
      if (occurrence) {
        occurrence.metadata = { templateState: "detached" };
        occurrence.derived = false;
      }
    } else {
      occurrences.set(occurrenceId, {
        occurrenceId,
        nodeId,
        parentNodeId: ownerNodeId,
        properties: {},
        metadata: { templateState: "linked" },
        derived: true,
      });
      appendUnique(listFor(children, ownerNodeId), occurrenceId);
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
  return instances;
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
  schemaId: string,
  templateNodeId: string,
): string | null {
  const removals = active.filter(
    (fact) => fact.body.mutation.kind === "schema-template-node-remove",
  );
  let result: string | null = null;
  for (const fact of active) {
    const mutation = fact.body.mutation;
    if (
      mutation.kind !== "schema-template-node-add" ||
      mutation.schemaId !== schemaId ||
      mutation.templateNodeId !== templateNodeId
    ) {
      continue;
    }
    const removed = removals.some((candidate) => {
      const removal = candidate.body.mutation;
      return (
        removal.kind === "schema-template-node-remove" &&
        removal.schemaId === mutation.schemaId &&
        removal.templateNodeId === mutation.templateNodeId &&
        removal.templateOccurrenceId === mutation.templateOccurrenceId &&
        observes(candidate, fact)
      );
    });
    if (!removed) {
      result = mutation.templateOccurrenceId;
    }
  }
  return result;
}

export function removeTemplateNodeOutputs(
  instances: readonly TemplateNodeInstance[],
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
): Readonly<Record<string, string | null>> {
  const result = { ...nodeOwners };
  const occurrenceIds = new Set<string>();
  for (const instance of instances) {
    const occurrence = occurrences.get(instance.instanceOccurrenceId);
    const stillProjected =
      instance.instanceNodeId === null && occurrence?.nodeId === instance.templateNodeId;
    if (stillProjected) {
      occurrenceIds.add(instance.instanceOccurrenceId);
      occurrences.delete(instance.instanceOccurrenceId);
    }
  }
  for (const [parent, childIds] of children) {
    children.set(
      parent,
      childIds.filter((occurrenceId) => !occurrenceIds.has(occurrenceId)),
    );
  }
  return result;
}

function detachments(
  active: readonly ContributionFact[],
): ReadonlyMap<string, readonly ContributionFact[]> {
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
    const schemaIds = mutation.sourceSchemaIds ?? [];
    const applicationSchemaIds = mutation.sourceApplicationSchemaIds ?? [];
    const itemIds = mutation.sourceTemplateOccurrenceIds ?? [];
    itemIds.forEach((templateOccurrenceId, index) => {
      const schemaId = schemaIds[index];
      const appliedSchemaId = applicationSchemaIds[index];
      if (schemaId && appliedSchemaId) {
        sources.set(`${appliedSchemaId}/${templateOccurrenceId}`, {
          schemaId,
          appliedSchemaId,
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
        candidate.appliedSchemaId === source.appliedSchemaId &&
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

function observes(observer: ContributionFact, observed: ContributionFact): boolean {
  const { replicaId, sequence } = observed.coordinate.dot;
  return (observer.coordinate.observed[replicaId] ?? 0) >= sequence;
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}
