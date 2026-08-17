import {
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
  SYSTEM_DEFINITION_CATALOG_NODE_ID,
  workspaceTrashOccurrenceId,
  workspaceSchemaNodeId,
  type FactSnapshot,
  type FactTransaction,
} from "../fact/index.js";
import { CURRENT_PROJECTION_VERSIONS, rebuildGeneration, type Projection } from "../reconcile/index.js";
import { nodeLocation, validateRootedNodeGraph } from "../reconcile/node-graph.js";
import { deriveActivation } from "../activation/index.js";
import { nodeDeletionFactIds } from "../maintenance/index.js";
import type { ContributionFact } from "../fact/index.js";
import { validateStructuralRoleChanges } from "./structural-role-validation.js";
import { validateRemovedTemplateFields } from "./template-field-transaction-validation.js";
import { validateFieldBindings } from "./field-binding-validation.js";

export function validateDomainTransaction(
  transaction: FactTransaction,
  before: FactSnapshot,
  after: FactSnapshot,
): void {
  validateTransactionIntent(transaction);
  validateInitialOwnerAttachments(transaction, before);
  validateNodeCreations(transaction);
  validateStructuralRoleChanges(transaction, before, after);
  validateCommittedDomainState(after);
}

function validateInitialOwnerAttachments(transaction: FactTransaction, before: FactSnapshot): void {
  const createdNodeIds = new Set(
    transaction.facts.flatMap((fact) =>
      fact.body.kind === "contribution" && fact.body.mutation.kind === "node-create" ? [fact.body.mutation.nodeId] : [],
    ),
  );
  const workspaceId = transaction.facts[0]?.workspaceId ?? "";
  const beforeGeneration = rebuildGeneration(workspaceId, before, CURRENT_PROJECTION_VERSIONS).generation;
  const detachedBefore = new Set(
    [beforeGeneration.origin, beforeGeneration.review].flatMap((projection) =>
      Object.entries(projection.nodeOwners).flatMap(([nodeId, ownerNodeId]) =>
        nodeId !== workspaceId && ownerNodeId === null ? [nodeId] : [],
      ),
    ),
  );
  const invalid = transaction.facts.find(
    (fact) =>
      fact.body.kind === "contribution" &&
      fact.body.mutation.kind === "node-owner-set" &&
      fact.body.mutation.previousOwnerNodeId === null &&
      !createdNodeIds.has(fact.body.mutation.nodeId) &&
      !detachedBefore.has(fact.body.mutation.nodeId),
  );
  if (invalid) {
    throw new Error("An initial Owner relation must accompany Node creation");
  }
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
    const ownerAttachments = transaction.facts.filter(
      (fact) =>
        fact.body.kind === "contribution" &&
        fact.body.mutation.kind === "node-owner-set" &&
        fact.body.mutation.nodeId === nodeId &&
        fact.body.mutation.ownerNodeId !== null &&
        fact.body.mutation.previousOwnerNodeId === null,
    );
    if (ownerAttachments.length !== 1) {
      throw new Error("Node creation transaction requires exactly one initial Owner relation");
    }
    const initialOwner = ownerAttachments[0]?.body;
    if (initialOwner?.kind !== "contribution" || initialOwner.mutation.kind !== "node-owner-set") {
      throw new Error("Node creation transaction has no initial Owner relation");
    }
    if (configurationAttachments.length > 1 || placements.length > 1) {
      throw new Error("Node creation transaction repeats a structural relation");
    }
    if (
      configurationAttachments.length === 1 &&
      configurationAttachments[0]?.body.kind === "contribution" &&
      configurationAttachments[0].body.mutation.kind === "metanode-attach" &&
      configurationAttachments[0].body.mutation.hostNodeId !== initialOwner.mutation.ownerNodeId
    ) {
      throw new Error("Metanode attachment and initial Owner relation disagree");
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
    validateMetanodeLifecycle(snapshot, projection);
    validateTrashLifecycle(snapshot, projection);
    validateOwnershipCompleteness(snapshot, projection);
    validateWorkspaceSystemNodes(projection);
    validateFieldBindings(snapshot, projection);
  }
}

function validateTrashLifecycle(snapshot: FactSnapshot, projection: Projection): void {
  const activation = deriveActivation(snapshot.facts, projection.perspective);
  const active = snapshot.facts.filter(
    (fact): fact is ContributionFact =>
      fact.body.kind === "contribution" && activation.activeContributionIds.has(fact.id),
  );
  const deleted = nodeDeletionFactIds(active);
  for (const nodeId of deleted.keys()) {
    if (projection.nodes[nodeId] === undefined) {
      continue;
    }
    if (nodeLocation(projection.identity.workspaceNodeId, projection, nodeId) !== "trash") {
      throw new Error(
        `Node deletion must place its root under Workspace Trash: ${nodeId} is owned by ${String(projection.nodeOwners[nodeId])}`,
      );
    }
  }
  const trashNodeId = projection.workspaceSystemNodes.trash;
  if (!trashNodeId) {
    return;
  }
  const unmarkedTrashRoot = Object.entries(projection.nodeOwners).find(
    ([nodeId, ownerNodeId]) =>
      projection.nodes[nodeId] !== undefined && ownerNodeId === trashNodeId && !deleted.has(nodeId),
  );
  if (unmarkedTrashRoot) {
    throw new Error("Workspace Trash root requires an active Node deletion");
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
  const catalogNodeId = projection.workspaceSystemNodes.systemDefinitionCatalog;
  if (catalogNodeId !== SYSTEM_DEFINITION_CATALOG_NODE_ID || projection.nodeOwners[catalogNodeId] !== workspaceNodeId) {
    throw new Error("Workspace System Definition Catalog Role is invalid");
  }
  const schemaNodeId = projection.workspaceSystemNodes.schema;
  if (
    schemaNodeId !== workspaceSchemaNodeId(workspaceNodeId) ||
    projection.nodeOwners[schemaNodeId] !== workspaceNodeId
  ) {
    throw new Error("Workspace Schema System Role is invalid");
  }
}

function validateOwnershipCompleteness(snapshot: FactSnapshot, projection: Projection): void {
  const activation = deriveActivation(snapshot.facts, projection.perspective);
  const activeRemovals = snapshot.facts.flatMap((fact) =>
    fact.body.kind === "contribution" &&
    activation.activeContributionIds.has(fact.id) &&
    fact.body.mutation.kind === "supertag-remove"
      ? [fact.body.mutation]
      : [],
  );
  const detachedApplicationNodeIds = new Set(activeRemovals.map((mutation) => mutation.applicationNodeId));
  const activeTemplateFieldDetaches = snapshot.facts.flatMap((fact) =>
    fact.body.kind === "contribution" &&
    activation.activeContributionIds.has(fact.id) &&
    fact.body.mutation.kind === "supertag-template-field-detach"
      ? [fact.body.mutation]
      : [],
  );
  validateDetachedSupertagApplications(activeRemovals, projection);
  validateRemovedTemplateFields(activeTemplateFieldDetaches, projection);
  validateRootedNodeGraph(
    projection.identity.workspaceNodeId,
    {
      nodes: new Map(Object.entries(projection.nodes)),
      occurrences: new Map(Object.entries(projection.occurrences)),
      childOccurrences: new Map(Object.entries(projection.childOccurrences)),
      nodeOwners: projection.nodeOwners,
      metanodes: projection.metanodes,
    },
    detachedApplicationNodeIds,
  );
}

function validateDetachedSupertagApplications(
  removals: readonly Extract<ContributionFact["body"]["mutation"], { kind: "supertag-remove" }>[],
  projection: Projection,
): void {
  for (const mutation of removals) {
    const restored = Object.values(projection.supertagApplications).some((applications) =>
      applications.some((application) => application.applicationNodeId === mutation.applicationNodeId),
    );
    if (restored) {
      continue;
    }
    if (projection.nodeOwners[mutation.applicationNodeId] !== null) {
      throw new Error(`Detached Supertag Application has an Owner: ${mutation.applicationNodeId}`);
    }
    const endpoints = projection.childOccurrences[mutation.applicationNodeId] ?? [];
    const relationDefinition = projection.occurrences[mutation.relationDefinitionOccurrenceId];
    const detachedValue = projection.occurrences[mutation.detachedValueOccurrenceId];
    if (
      projection.occurrences[mutation.applicationOccurrenceId] !== undefined ||
      projection.occurrences[mutation.definitionOccurrenceId] !== undefined ||
      relationDefinition?.nodeId !== NODE_SUPERTAGS_DEFINITION_NODE_ID ||
      relationDefinition.parentNodeId !== mutation.applicationNodeId ||
      detachedValue?.nodeId !== mutation.detachedValueNodeId ||
      detachedValue.parentNodeId !== mutation.applicationNodeId ||
      projection.nodeOwners[mutation.detachedValueNodeId] !== mutation.applicationNodeId ||
      endpoints.length !== 2 ||
      endpoints[0] !== mutation.relationDefinitionOccurrenceId ||
      endpoints[1] !== mutation.detachedValueOccurrenceId
    ) {
      throw new Error(`Detached Supertag Application structure is invalid: ${mutation.applicationNodeId}`);
    }
  }
}
