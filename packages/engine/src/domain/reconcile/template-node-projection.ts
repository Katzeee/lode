import { stableStringCompare, type ContributionFact, type JsonValue } from "../fact/index.js";
import { applyText, applyValues } from "./projection-content.js";
import { createNodes, type MutableNode, type MutableOccurrence } from "./projection-state.js";
import { schemaExtensionGraph } from "./schema-extension-graph.js";
import {
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  templateNodeItemId,
} from "./template-node-identity.js";
import type { TemplateNodeInstance, TemplateNodeSource } from "./projection-types.js";
import { listFor } from "./sequence.js";
import { valueOwnerAddress } from "./value-address.js";

export function projectTemplateNodeInstances(
  active: readonly ContributionFact[],
  schemaApplications: Readonly<Record<string, readonly string[]>>,
  schemaTemplateNodes: Readonly<Record<string, readonly string[]>>,
  schemaExtensions: Readonly<Record<string, readonly string[]>>,
  nodes: Map<string, MutableNode>,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
  canonicalOccurrences: Readonly<Record<string, string>>,
): readonly TemplateNodeInstance[] {
  const extensionGraph = schemaExtensionGraph(schemaExtensions);
  const currentSources = new Map<string, TemplateNodeSource[]>();
  for (const [ownerNodeId, appliedSchemaIds] of Object.entries(schemaApplications)) {
    for (const appliedSchemaId of appliedSchemaIds) {
      for (const schemaId of extensionGraph.lineage(appliedSchemaId)) {
        for (const templateNodeId of schemaTemplateNodes[schemaId] ?? []) {
          appendSource(currentSources, ownerNodeId, templateNodeId, {
            schemaId,
            appliedSchemaId,
            templateItemId: templateNodeItemId(schemaId, templateNodeId),
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
    const ownerOccurrenceId = canonicalOccurrences[ownerNodeId];
    const current = currentSources.get(identity) ?? [];
    const detachFacts = detaches.get(identity) ?? [];
    if (!ownerOccurrenceId || (!nodes.has(templateNodeId) && detachFacts.length === 0)) {
      continue;
    }
    const occurrenceId = templateInstanceOccurrenceId(ownerNodeId, templateNodeId);
    const detached = detachFacts.length > 0;
    const nodeId = detached ? templateInstanceNodeId(ownerNodeId, templateNodeId) : templateNodeId;
    if (detached) {
      nodes.set(nodeId, detachedNode(active, detachFacts, templateNodeId, nodeId));
    }
    occurrences.set(occurrenceId, {
      occurrenceId,
      nodeId,
      parentOccurrenceId: ownerOccurrenceId,
      properties: {},
      metadata: { templateState: detached ? "detached" : "linked" },
      managed: !detached,
    });
    listFor(children, ownerOccurrenceId).push(occurrenceId);
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

export function removeTemplateNodeOutputs(
  instances: readonly TemplateNodeInstance[],
  nodes: Map<string, MutableNode>,
  occurrences: Map<string, MutableOccurrence>,
  children: Map<string, string[]>,
  canonicalOccurrences: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const result = { ...canonicalOccurrences };
  const occurrenceIds = new Set(instances.map((instance) => instance.instanceOccurrenceId));
  for (const instance of instances) {
    occurrences.delete(instance.instanceOccurrenceId);
    if (instance.instanceNodeId !== null) {
      nodes.delete(instance.instanceNodeId);
      delete result[instance.instanceNodeId];
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

function detachedNode(
  active: readonly ContributionFact[],
  detachFacts: readonly ContributionFact[],
  templateNodeId: string,
  instanceNodeId: string,
): MutableNode {
  const observed = active.filter((candidate) =>
    detachFacts.some((detachment) => observes(detachment, candidate)),
  );
  const sourceNodes = createNodes(observed);
  applyText(observed, sourceNodes);
  const source = sourceNodes.get(templateNodeId);
  const values = applyValues(observed);
  return {
    nodeId: instanceNodeId,
    text: source?.text.map((atom) => ({ ...atom, attributes: { ...atom.attributes } })) ?? [],
    properties: copiedValues(values, templateNodeId, "property", "schema"),
    metadata: copiedValues(values, templateNodeId, "metadata"),
  };
}

function copiedValues(
  values: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>,
  nodeId: string,
  ...namespaces: readonly ("property" | "metadata" | "schema")[]
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const namespace of namespaces) {
    Object.assign(result, values[valueOwnerAddress({ kind: "node", id: nodeId }, namespace)]);
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
    const itemIds = mutation.sourceTemplateItemIds ?? [];
    itemIds.forEach((templateItemId, index) => {
      const schemaId = schemaIds[index];
      const appliedSchemaId = applicationSchemaIds[index];
      if (schemaId && appliedSchemaId) {
        sources.set(`${appliedSchemaId}/${templateItemId}`, {
          schemaId,
          appliedSchemaId,
          templateItemId,
        });
      }
    });
  }
  return [...sources.values()].sort((left, right) =>
    stableStringCompare(left.templateItemId, right.templateItemId),
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
        candidate.templateItemId === source.templateItemId,
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
