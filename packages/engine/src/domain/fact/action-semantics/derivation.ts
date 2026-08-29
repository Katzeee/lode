import {
  addAnchorRelations,
  addChildrenRelation,
  addSupertagRelation,
  createActionRelationCollection,
  finishActionRelationCollection,
  type ActionRelations,
  type MutableActionRelations,
} from "../action-relation-collection.js";
import { canonicalJson } from "../canonical.js";
import {
  fieldDefinitionEndpointOccurrenceId,
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
} from "../identity.js";
import type { SemanticContribution, SemanticIdentity } from "./types.js";

export function relationsFromContributions(contributions: readonly SemanticContribution[]): ActionRelations {
  const relations = createActionRelationCollection();
  for (const contribution of contributions) {
    addContributionRelations(relations, contribution);
  }
  return finishActionRelationCollection(relations);
}

export function contributionOwnersFromContributions(contributions: readonly SemanticContribution[]): readonly string[] {
  const owners = new Set<string>();
  for (const contribution of contributions) {
    if (contribution.kind === "identity" && contribution.roles.includes("contribution-owner")) {
      const nodeId = identityNodeId(contribution.identity);
      if (nodeId !== null) {
        owners.add(nodeId);
      }
    } else if (contribution.kind === "node-declaration" || contribution.kind === "node-lifecycle") {
      owners.add(contribution.nodeId);
    } else if (contribution.kind === "text-operation" || contribution.kind === "terminal-cutoff") {
      owners.add(contribution.nodeId);
    } else if (contribution.kind === "field-materialization") {
      const fieldNodeId = materializedFieldNodeId(contribution.ownerNodeId, contribution.fieldDefinitionId);
      owners.add(contribution.ownerNodeId);
      owners.add(fieldNodeId);
    }
  }
  return [...owners];
}

export function requirementsFromContributions(
  contributions: readonly SemanticContribution[],
): readonly SemanticIdentity[] {
  const requirements: SemanticIdentity[] = [];
  for (const contribution of contributions) {
    if (contribution.kind === "identity" && contribution.roles.includes("require")) {
      requirements.push(contribution.identity);
    } else if (contribution.kind === "node-declaration" && contribution.ownerNodeId !== undefined) {
      requirements.push({ kind: "node", nodeId: contribution.ownerNodeId });
    } else if (contribution.kind === "sequence-position") {
      if (contribution.operation === "move" || contribution.operation === "remove") {
        requirements.push({ kind: "occurrence", occurrenceId: contribution.occurrenceId });
      }
      if (contribution.operation !== "remove") {
        if (contribution.operation === "insert" && contribution.nodeId !== undefined) {
          requirements.push({ kind: "node", nodeId: contribution.nodeId });
        }
        requirements.push({ kind: "node", nodeId: contribution.parentNodeId });
      }
    } else if (contribution.kind === "node-lifecycle") {
      requirements.push({ kind: "node", nodeId: contribution.nodeId });
      if (contribution.occurrenceId !== undefined) {
        requirements.push({ kind: "occurrence", occurrenceId: contribution.occurrenceId });
      }
      if (contribution.parentNodeId !== undefined) {
        requirements.push({ kind: "node", nodeId: contribution.parentNodeId });
      }
    } else if (contribution.kind === "text-operation") {
      requirements.push({ kind: "node", nodeId: contribution.nodeId });
    } else if (contribution.kind === "field-materialization") {
      const fieldNodeId = materializedFieldNodeId(contribution.ownerNodeId, contribution.fieldDefinitionId);
      const fieldOccurrenceId = materializedFieldOccurrenceId(contribution.ownerNodeId, contribution.fieldDefinitionId);
      requirements.push({ kind: "node", nodeId: contribution.ownerNodeId });
      requirements.push({ kind: "node", nodeId: contribution.fieldDefinitionId });
      requirements.push({ kind: "node", nodeId: fieldNodeId });
      requirements.push({ kind: "occurrence", occurrenceId: fieldOccurrenceId });
      requirements.push({
        kind: "occurrence",
        occurrenceId: fieldDefinitionEndpointOccurrenceId(fieldOccurrenceId),
      });
      requirements.push({
        kind: "intrinsic-node-type",
        nodeId: contribution.fieldDefinitionId,
        intrinsicNodeType: "field-definition",
      });
    }
  }
  const produced = new Set(producersFromContributions(contributions).map(canonicalJson));
  return uniqueIdentities(requirements).filter((identity) => !produced.has(canonicalJson(identity)));
}

export function producersFromContributions(
  contributions: readonly SemanticContribution[],
): readonly SemanticIdentity[] {
  const producers: SemanticIdentity[] = [];
  for (const contribution of contributions) {
    if (contribution.kind === "identity" && contribution.roles.includes("declare")) {
      producers.push(contribution.identity);
    } else if (contribution.kind === "node-declaration") {
      producers.push({ kind: "node", nodeId: contribution.nodeId });
      if (contribution.intrinsicNodeType !== undefined) {
        producers.push({
          kind: "intrinsic-node-type",
          nodeId: contribution.nodeId,
          intrinsicNodeType: contribution.intrinsicNodeType,
        });
      }
    } else if (contribution.kind === "sequence-position" && contribution.operation === "insert") {
      producers.push({ kind: "occurrence", occurrenceId: contribution.occurrenceId });
    }
  }
  return uniqueIdentities(producers);
}

function addContributionRelations(relations: MutableActionRelations, contribution: SemanticContribution): void {
  switch (contribution.kind) {
    case "identity":
      if (contribution.roles.includes("relate")) {
        addIdentityRelations(relations, contribution.identity);
      }
      return;
    case "node-declaration":
      relations.nodeIds.add(contribution.nodeId);
      if (contribution.ownerNodeId !== undefined) {
        addChildrenRelation(relations, contribution.ownerNodeId);
      }
      return;
    case "sequence-position":
      relations.occurrenceIds.add(contribution.occurrenceId);
      if (contribution.operation !== "remove") {
        if (contribution.nodeId !== undefined) {
          relations.nodeIds.add(contribution.nodeId);
        }
        addChildrenRelation(relations, contribution.parentNodeId);
        addAnchorRelations(relations, contribution.anchor);
      }
      return;
    case "node-lifecycle":
      relations.nodeIds.add(contribution.nodeId);
      if (contribution.occurrenceId !== undefined) {
        relations.occurrenceIds.add(contribution.occurrenceId);
      }
      if (contribution.parentNodeId !== undefined) {
        addChildrenRelation(relations, contribution.parentNodeId);
      }
      addAnchorRelations(relations, contribution.anchor);
      return;
    case "text-operation":
      relations.nodeIds.add(contribution.nodeId);
      contribution.referencedActionIds.forEach((id) => relations.actionIds.add(id));
      if (contribution.operation === "splice") {
        addAnchorRelations(relations, contribution.anchor);
      }
      return;
    case "field-materialization": {
      const fieldNodeId = materializedFieldNodeId(contribution.ownerNodeId, contribution.fieldDefinitionId);
      const fieldOccurrenceId = materializedFieldOccurrenceId(contribution.ownerNodeId, contribution.fieldDefinitionId);
      relations.nodeIds.add(contribution.ownerNodeId);
      addFieldDefinitionRelations(relations, contribution.fieldDefinitionId);
      addChildrenRelation(relations, fieldNodeId);
      relations.occurrenceIds.add(fieldOccurrenceId);
      relations.occurrenceIds.add(fieldDefinitionEndpointOccurrenceId(fieldOccurrenceId));
      return;
    }
    case "generated-occurrence":
      relations.occurrenceIds.add(contribution.occurrenceId);
      return;
    case "causal-register-write":
      return;
    case "terminal-cutoff":
      relations.nodeIds.add(contribution.nodeId);
      return;
    case "causal-collection":
      return;
    default:
      contribution satisfies never;
  }
}

function addIdentityRelations(relations: MutableActionRelations, identity: SemanticIdentity): void {
  switch (identity.kind) {
    case "node":
    case "intrinsic-node-type":
      relations.nodeIds.add(identity.nodeId);
      return;
    case "node-children":
      addChildrenRelation(relations, identity.nodeId);
      return;
    case "occurrence":
      relations.occurrenceIds.add(identity.occurrenceId);
      return;
    case "fact-action":
      relations.actionIds.add(identity.factActionId);
      return;
    case "inline-reference":
      relations.inlineReferenceIds.add(identity.inlineReferenceId);
      return;
    case "inline-alias":
      relations.inlineReferenceIds.add(identity.inlineReferenceId);
      relations.nodeIds.add(identity.aliasNodeId);
      return;
    case "supertag":
      addSupertagRelation(relations, identity.nodeId);
      if (identity.instanceLookup) {
        relations.instanceSupertagIds.add(identity.nodeId);
      }
      return;
    case "field-definition":
      addFieldDefinitionRelations(relations, identity.nodeId);
  }
}

function addFieldDefinitionRelations(relations: MutableActionRelations, nodeId: string): void {
  relations.nodeIds.add(nodeId);
  relations.fieldDefinitionIds.add(nodeId);
}

function identityNodeId(identity: SemanticIdentity): string | null {
  switch (identity.kind) {
    case "node":
    case "node-children":
    case "supertag":
    case "field-definition":
    case "intrinsic-node-type":
      return identity.nodeId;
    case "occurrence":
    case "fact-action":
    case "inline-reference":
    case "inline-alias":
      return null;
  }
}

function uniqueIdentities(identities: readonly SemanticIdentity[]): readonly SemanticIdentity[] {
  return [...new Map(identities.map((identity) => [canonicalJson(identity), identity])).values()];
}
