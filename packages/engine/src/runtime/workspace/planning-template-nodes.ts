import { templateInstanceOccurrenceId, type Mutation } from "../../domain/fact/index.js";
import {
  schemaExtensionGraph,
  type TemplateNodeSource,
  type Projection,
} from "../../domain/reconcile/index.js";
import type { MutableProjection } from "./planning-projection-mutation.js";
import { anchorAt, assertRelationAnchor } from "./planning-projection-sequence.js";

export function applyTemplatePlanningMutation(
  projection: MutableProjection,
  mutation: Mutation,
  factId: string,
): boolean {
  if (mutation.kind === "schema-template-node-add") {
    const nodeIds = (projection.schemaTemplateNodes[mutation.schemaId] ??= []);
    remove(nodeIds, mutation.templateNodeId);
    nodeIds.push(mutation.templateNodeId);
    sortTemplateNodes(projection, mutation.schemaId);
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
  if (!instance || instance.state !== "linked") {
    return true;
  }
  const nodeId = mutation.instanceNodeId;
  delete projection.occurrences[instance.instanceOccurrenceId];
  removeFromChildren(projection, instance.instanceOccurrenceId);
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
    if (!(ownerNodeId in projection.nodeOwners) || !projection.nodes[templateNodeId]) {
      continue;
    }
    const instanceOccurrenceId = templateInstanceOccurrenceId(ownerNodeId, templateNodeId);
    projection.occurrences[instanceOccurrenceId] = {
      occurrenceId: instanceOccurrenceId,
      nodeId: templateNodeId,
      parentNodeId: ownerNodeId,
      properties: {},
      metadata: { templateState: "linked" },
      derived: true,
    };
    const children = (projection.children[ownerNodeId] ??= []);
    projection.children[ownerNodeId] = [...children, instanceOccurrenceId];
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
    !(removing && available.nodeStatuses[mutation.schemaId]?.state === "deleted")
  ) {
    throw new Error(`Schema Definition is deleted or does not exist: ${mutation.schemaId}`);
  }
  if (!removing && !available.nodes[mutation.templateNodeId]) {
    throw new Error(`Template Node does not exist: ${mutation.templateNodeId}`);
  }
  if (mutation.kind === "schema-template-node-add") {
    if (
      available.occurrences[mutation.templateOccurrenceId] &&
      (available.occurrences[mutation.templateOccurrenceId]?.nodeId !== mutation.templateNodeId ||
        available.occurrences[mutation.templateOccurrenceId]?.parentNodeId !== mutation.schemaId)
    ) {
      throw new Error("Template Node Occurrence identity already exists");
    }
    const existingOccurrence = templateOccurrenceFor(
      available,
      mutation.schemaId,
      mutation.templateNodeId,
    );
    if (existingOccurrence && existingOccurrence !== mutation.templateOccurrenceId) {
      throw new Error("Schema already contains the Template Node");
    }
    assertRelationAnchor(
      available.children[mutation.schemaId] ?? [],
      mutation.anchor,
      "Schema Template Node",
    );
    return mutation;
  }
  const occurrence = available.occurrences[mutation.templateOccurrenceId];
  if (
    occurrence?.nodeId !== mutation.templateNodeId ||
    occurrence.parentNodeId !== mutation.schemaId
  ) {
    throw new Error("Schema Template Node does not exist");
  }
  const children = available.children[mutation.schemaId] ?? [];
  return {
    ...mutation,
    previousAnchor: anchorAt(children, children.indexOf(mutation.templateOccurrenceId)),
  };
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
          const templateOccurrenceId = templateOccurrenceFor(projection, schemaId, templateNodeId);
          if (templateOccurrenceId === null) {
            continue;
          }
          const identity = key(ownerNodeId, templateNodeId);
          const sources = result.get(identity) ?? [];
          const source = {
            schemaId,
            appliedSchemaId,
            templateOccurrenceId,
          };
          if (
            !sources.some(
              (candidate) =>
                candidate.appliedSchemaId === source.appliedSchemaId &&
                candidate.templateOccurrenceId === source.templateOccurrenceId,
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

function templateOccurrenceFor(
  projection: Pick<Projection, "occurrences">,
  schemaId: string,
  templateNodeId: string,
): string | null {
  return (
    Object.values(projection.occurrences)
      .filter(
        (occurrence) =>
          occurrence.parentNodeId === schemaId && occurrence.nodeId === templateNodeId,
      )
      .map((occurrence) => occurrence.occurrenceId)
      .sort()[0] ?? null
  );
}

function sortTemplateNodes(projection: MutableProjection, schemaId: string): void {
  const children = projection.children[schemaId] ?? [];
  projection.schemaTemplateNodes[schemaId]?.sort((left, right) => {
    const leftOccurrence = templateOccurrenceFor(projection, schemaId, left);
    const rightOccurrence = templateOccurrenceFor(projection, schemaId, right);
    return children.indexOf(leftOccurrence ?? "") - children.indexOf(rightOccurrence ?? "");
  });
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
