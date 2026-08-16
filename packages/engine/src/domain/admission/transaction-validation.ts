import { FIELD_NODE_TYPE, workspaceTrashOccurrenceId, type FactSnapshot, type FactTransaction } from "../fact/index.js";
import { CURRENT_PROJECTION_VERSIONS, rebuildGeneration, type Projection } from "../reconcile/index.js";
import { nodeLocation, validateRootedNodeGraph } from "../reconcile/node-graph.js";
import { deriveActivation } from "../activation/index.js";
import { nodeDeletionFactIds } from "../maintenance/index.js";
import type { ContributionFact } from "../fact/index.js";

export function validateDomainTransaction(
  transaction: FactTransaction,
  _before: FactSnapshot,
  after: FactSnapshot,
): void {
  validateTransactionIntent(transaction);
  validateNodeCreations(transaction);
  validateCommittedDomainState(after);
}

function validateTransactionIntent(transaction: FactTransaction): void {
  if (transaction.facts.length === 1) {
    return;
  }
  const first = transaction.facts[0]?.body;
  if (first?.kind !== "contribution") {
    throw new Error("A multi-Fact domain transaction must contain only Contributions");
  }
  for (const fact of transaction.facts) {
    if (fact.body.kind !== "contribution" || fact.body.actorId !== first.actorId || fact.body.intent !== first.intent) {
      throw new Error("A multi-Fact domain transaction requires one actor and one intent");
    }
  }
}

function validateNodeCreations(transaction: FactTransaction): void {
  const workspaceId = transaction.facts[0]?.workspaceId;
  const creations = transaction.facts.flatMap((fact) =>
    fact.body.kind === "contribution" && fact.body.mutation.kind === "node-create" ? [fact.body.mutation.nodeId] : [],
  );
  for (const nodeId of creations) {
    if (nodeId === workspaceId) {
      continue;
    }
    const placements = transaction.facts.filter(
      (fact) =>
        fact.body.kind === "contribution" &&
        fact.body.mutation.kind === "occurrence-create" &&
        fact.body.mutation.nodeId === nodeId,
    );
    const configurationAttachments = transaction.facts.filter(
      (fact) =>
        fact.body.kind === "contribution" &&
        fact.body.mutation.kind === "metanode-attach" &&
        fact.body.mutation.metanodeId === nodeId,
    );
    const isOutlineNode = placements.length === 1 && configurationAttachments.length === 0;
    const isMetanode = placements.length === 0 && configurationAttachments.length === 1;
    if (!isOutlineNode && !isMetanode) {
      throw new Error("Node creation transaction requires exactly one Original Occurrence");
    }
  }
}

function validateCommittedDomainState(snapshot: FactSnapshot): void {
  const generation = rebuildGeneration(
    snapshot.facts[0]?.workspaceId ?? "",
    snapshot,
    CURRENT_PROJECTION_VERSIONS,
  ).generation;
  for (const projection of [generation.origin, generation.review]) {
    validateOwnershipCompleteness(projection);
    validateWorkspaceSystemNodes(projection);
    validateFieldBindings(projection);
    validateMetanodeLifecycle(snapshot, projection);
  }
}

function validateMetanodeLifecycle(snapshot: FactSnapshot, projection: Projection): void {
  const activation = deriveActivation(snapshot.facts, projection.perspective);
  const active = snapshot.facts.filter(
    (fact): fact is ContributionFact =>
      fact.body.kind === "contribution" && activation.activeContributionIds.has(fact.id),
  );
  const deleted = nodeDeletionFactIds(active);
  const rootNodeId = Object.values(projection.metanodes).find((nodeId) => deleted.has(nodeId));
  if (rootNodeId) {
    throw new Error("Metanode cannot be deleted independently of its host");
  }
}

function validateWorkspaceSystemNodes(projection: Projection): void {
  const workspaceNodeId = projection.identity.workspaceNodeId;
  const trashNodeId = projection.workspaceSystemNodes.trash;
  if (!trashNodeId) {
    throw new Error("Workspace has no Trash System Role");
  }
  const roleOccurrence = projection.occurrences[workspaceTrashOccurrenceId(workspaceNodeId)];
  if (
    !projection.nodes[trashNodeId] ||
    roleOccurrence?.nodeId !== trashNodeId ||
    roleOccurrence.parentNodeId !== workspaceNodeId ||
    projection.nodeOwners[trashNodeId] !== workspaceNodeId
  ) {
    throw new Error("Workspace Trash System Role is invalid");
  }
}

function validateOwnershipCompleteness(projection: Projection): void {
  validateRootedNodeGraph(projection.identity.workspaceNodeId, {
    nodes: new Map(Object.entries(projection.nodes)),
    occurrences: new Map(Object.entries(projection.occurrences)),
    childOccurrences: new Map(Object.entries(projection.childOccurrences)),
    nodeOwners: projection.nodeOwners,
    metanodes: projection.metanodes,
  });
}

function validateFieldBindings(projection: Projection): void {
  const activeFieldNodeIds = Object.values(projection.nodes).flatMap((node) =>
    node.nodeType === FIELD_NODE_TYPE &&
    nodeLocation(projection.identity.workspaceNodeId, projection, node.nodeId) === "active"
      ? [node.nodeId]
      : [],
  );
  const boundFieldNodeIds = new Set([
    ...Object.values(projection.templateFields).flatMap((fields) => fields.map((field) => field.fieldNodeId)),
    ...Object.values(projection.materializedFields).flatMap((fields) => fields.map((field) => field.fieldNodeId)),
  ]);
  const unboundFieldNodeId = activeFieldNodeIds.find((nodeId) => !boundFieldNodeIds.has(nodeId));
  if (unboundFieldNodeId) {
    throw new Error(`Field Node has no Field Definition binding: ${unboundFieldNodeId}`);
  }
}
