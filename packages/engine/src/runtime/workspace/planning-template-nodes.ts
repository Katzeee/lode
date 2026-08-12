import type { Mutation, SequenceAnchor } from "../../domain/fact/index.js";
import {
  schemaExtensionGraph,
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  templateNodeItemId,
  type TemplateNodeSource,
  type Projection,
} from "../../domain/reconcile/index.js";
import type { MutableProjection } from "./planning-projection-mutation.js";
import { insertionIndex } from "./planning-projection-sequence.js";

export function applyTemplatePlanningMutation(
  projection: MutableProjection,
  mutation: Mutation,
  factId: string,
): boolean {
  if (mutation.kind === "schema-template-node-add") {
    const nodeIds = (projection.schemaTemplateNodes[mutation.schemaId] ??= []);
    remove(nodeIds, mutation.templateNodeId);
    nodeIds.splice(
      insertionIndex(
        nodeIds.map((id) => ({ id })),
        mutation.anchor,
      ),
      0,
      mutation.templateNodeId,
    );
    refreshPlanningTemplateNodeInstances(projection);
    return true;
  }
  if (mutation.kind === "schema-template-node-remove") {
    remove(projection.schemaTemplateNodes[mutation.schemaId] ?? [], mutation.templateNodeId);
    refreshPlanningTemplateNodeInstances(projection);
    return true;
  }
  if (mutation.kind !== "template-node-detach") {
    return false;
  }
  const index = projection.templateNodeInstances.findIndex(
    (candidate) =>
      candidate.ownerNodeId === mutation.ownerNodeId &&
      candidate.templateNodeId === mutation.templateNodeId,
  );
  const instance = projection.templateNodeInstances[index];
  const source = projection.nodes[mutation.templateNodeId];
  if (!instance || instance.state !== "linked" || !source) {
    return true;
  }
  const nodeId = templateInstanceNodeId(mutation.ownerNodeId, mutation.templateNodeId);
  projection.nodes[nodeId] = {
    nodeId,
    text: source.text.map((atom) => ({ ...atom, attributes: { ...atom.attributes } })),
    properties: { ...source.properties },
    metadata: { ...source.metadata },
  };
  const occurrence = projection.occurrences[instance.instanceOccurrenceId];
  if (occurrence) {
    projection.occurrences[instance.instanceOccurrenceId] = {
      ...occurrence,
      nodeId,
      managed: false,
      metadata: { ...occurrence.metadata, templateState: "detached" },
    };
  }
  projection.canonicalOccurrences[nodeId] = instance.instanceOccurrenceId;
  projection.templateNodeInstances[index] = {
    ...instance,
    instanceNodeId: nodeId,
    state: "detached",
    detachmentContributionIds: [factId],
  };
  return true;
}

export function refreshPlanningTemplateNodeInstances(projection: MutableProjection): void {
  const detached = new Map(
    projection.templateNodeInstances
      .filter((instance) => instance.state === "detached")
      .map((instance) => [key(instance.ownerNodeId, instance.templateNodeId), instance]),
  );
  for (const instance of projection.templateNodeInstances) {
    if (instance.state === "linked") {
      delete projection.occurrences[instance.instanceOccurrenceId];
      removeFromChildren(projection, instance.instanceOccurrenceId);
    }
  }
  const effective = effectiveSources(projection);
  const next: MutableProjection["templateNodeInstances"] = [];
  for (const [identity, sources] of effective) {
    const [ownerNodeId, templateNodeId] = parseKey(identity);
    const existing = detached.get(identity);
    if (existing) {
      next.push({ ...existing, sources });
      detached.delete(identity);
      continue;
    }
    const parentOccurrenceId = projection.canonicalOccurrences[ownerNodeId];
    if (!parentOccurrenceId || !projection.nodes[templateNodeId]) {
      continue;
    }
    const instanceOccurrenceId = templateInstanceOccurrenceId(ownerNodeId, templateNodeId);
    projection.occurrences[instanceOccurrenceId] = {
      occurrenceId: instanceOccurrenceId,
      nodeId: templateNodeId,
      parentOccurrenceId,
      properties: {},
      metadata: { templateState: "linked" },
      managed: true,
    };
    const children = (projection.children[parentOccurrenceId] ??= []);
    projection.children[parentOccurrenceId] = [...children, instanceOccurrenceId];
    next.push({
      ownerNodeId,
      templateNodeId,
      instanceNodeId: null,
      instanceOccurrenceId,
      state: "linked",
      sources,
      detachmentContributionIds: [],
    });
  }
  next.push(...detached.values());
  projection.templateNodeInstances = next;
}

export function prepareTemplateNodeRelation(
  mutation: Extract<Mutation, { kind: `schema-${string}` }>,
  available: Projection,
): Mutation | null {
  if (
    mutation.kind !== "schema-template-node-add" &&
    mutation.kind !== "schema-template-node-remove"
  ) {
    return null;
  }
  const removing = mutation.kind === "schema-template-node-remove";
  if (
    !available.nodes[mutation.schemaId] &&
    !(removing && available.definitionStatuses[mutation.schemaId]?.state === "deleted")
  ) {
    throw new Error(`Schema Definition is deleted or does not exist: ${mutation.schemaId}`);
  }
  if (!removing && !available.nodes[mutation.templateNodeId]) {
    throw new Error(`Template Node does not exist: ${mutation.templateNodeId}`);
  }
  const nodeIds = available.schemaTemplateNodes[mutation.schemaId] ?? [];
  if (mutation.kind === "schema-template-node-add") {
    assertRelationAnchor(nodeIds, mutation.anchor);
    return mutation;
  }
  const index = nodeIds.indexOf(mutation.templateNodeId);
  if (index < 0) {
    throw new Error("Schema Template Node does not exist");
  }
  return { ...mutation, previousAnchor: anchorAt(nodeIds, index) };
}

function effectiveSources(
  projection: MutableProjection,
): ReadonlyMap<string, readonly TemplateNodeSource[]> {
  const graph = schemaExtensionGraph(projection.schemaExtensions);
  const result = new Map<string, TemplateNodeSource[]>();
  for (const [ownerNodeId, appliedSchemaIds] of Object.entries(projection.schemaApplications)) {
    for (const appliedSchemaId of appliedSchemaIds) {
      for (const schemaId of graph.lineage(appliedSchemaId)) {
        for (const templateNodeId of projection.schemaTemplateNodes[schemaId] ?? []) {
          const identity = key(ownerNodeId, templateNodeId);
          const sources = result.get(identity) ?? [];
          const source = {
            schemaId,
            appliedSchemaId,
            templateItemId: templateNodeItemId(schemaId, templateNodeId),
          };
          if (
            !sources.some(
              (candidate) =>
                candidate.appliedSchemaId === source.appliedSchemaId &&
                candidate.templateItemId === source.templateItemId,
            )
          ) {
            sources.push(source);
          }
          result.set(identity, sources);
        }
      }
    }
  }
  return result;
}

function removeFromChildren(projection: MutableProjection, occurrenceId: string): void {
  for (const [parent, children] of Object.entries(projection.children)) {
    projection.children[parent] = children.filter((childId) => childId !== occurrenceId);
  }
}

function key(ownerNodeId: string, templateNodeId: string): string {
  return JSON.stringify([ownerNodeId, templateNodeId]);
}

function parseKey(value: string): readonly [string, string] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") {
    throw new Error("Invalid Template Node planning identity");
  }
  return [parsed[0], parsed[1]];
}

function remove(values: string[], value: string): void {
  const index = values.indexOf(value);
  if (index >= 0) {
    values.splice(index, 1);
  }
}

function assertRelationAnchor(identities: readonly string[], anchor: SequenceAnchor): void {
  if ([anchor.after, anchor.before].some((id) => id !== null && !identities.includes(id))) {
    throw new Error("Schema Template Node anchor does not exist");
  }
}

function anchorAt(identities: readonly string[], index: number): SequenceAnchor {
  return {
    after: identities[index - 1] ?? null,
    before: identities[index + 1] ?? null,
    affinity: index === 0 ? "before" : "after",
    fallback: index === 0 ? "start" : "end",
  };
}
