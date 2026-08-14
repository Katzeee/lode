import { pendingProposalActivation } from "../activation/index.js";
import {
  canonicalJson,
  compareFacts,
  isFieldContentDeletionMutation,
  isOccurrenceMutation,
  stableStringCompare,
  type ContributionFact,
  type FactSnapshot,
  type Mutation,
  type OccurrenceMutation,
  type ValueMutation,
} from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import {
  fieldContentDeletionScopes,
  isTemplateNodeMutation,
  templateNodeScopes,
} from "./read-model-scopes.js";

export type ReviewReadModel = Readonly<{
  scopes: Readonly<Record<string, readonly string[]>>;
  supportByContribution: Readonly<Record<string, readonly string[]>>;
}>;

export function createReviewReadModel(
  snapshot: FactSnapshot,
  review: Pick<ScopedProjection, "occurrences">,
): ReviewReadModel {
  const activation = pendingProposalActivation(snapshot);
  const scopes = reviewPaginationScopes(
    activation.pending,
    (occurrenceId) => review.occurrences[occurrenceId]?.nodeId ?? null,
  );
  return {
    scopes: Object.fromEntries(
      [...scopes].map(([identity, facts]) => [identity, facts.map((fact) => fact.id)]),
    ),
    supportByContribution: Object.fromEntries(
      [...activation.pending.keys()]
        .sort(stableStringCompare)
        .map((id) => [id, activation.supportByContribution.get(id) ?? []]),
    ),
  };
}

function reviewPaginationScopes(
  pending: ReadonlyMap<string, ContributionFact>,
  occurrenceNodeId: (occurrenceId: string) => string | null,
): ReadonlyMap<string, readonly ContributionFact[]> {
  const groups: { keys: Set<string>; facts: ContributionFact[] }[] = [];
  for (const fact of pending.values()) {
    const keys = new Set(scopeKeys(fact.body.mutation, occurrenceNodeId));
    const matching = groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => [...keys].some((key) => group.keys.has(key)));
    const first = matching[0];
    if (!first) {
      groups.push({ keys, facts: [fact] });
      continue;
    }
    first.group.facts.push(fact);
    keys.forEach((key) => first.group.keys.add(key));
    for (const { group, index } of matching.slice(1).reverse()) {
      group.keys.forEach((key) => first.group.keys.add(key));
      first.group.facts.push(...group.facts);
      groups.splice(index, 1);
    }
  }
  return new Map(
    groups.map((group) => [
      canonicalJson([...group.keys].sort(stableStringCompare)),
      group.facts.sort(compareFacts),
    ]),
  );
}

function scopeKeys(
  mutation: Mutation,
  occurrenceNodeId: (occurrenceId: string) => string | null,
): readonly string[] {
  if (isTemplateNodeMutation(mutation)) {
    return templateNodeScopes(mutation);
  }
  if (isFieldContentDeletionMutation(mutation)) {
    return fieldContentDeletionScopes(mutation);
  }
  if (isLifecycleMutation(mutation)) {
    return [canonicalJson(["lifecycle", mutation.nodeId]), associatedNode(mutation.nodeId)];
  }
  if (mutation.kind === "node-owner-set") {
    return [canonicalJson(["owner", mutation.nodeId]), associatedNode(mutation.nodeId)];
  }
  if (mutation.kind === "node-type-declare") {
    return [canonicalJson(["node-type", mutation.nodeId]), associatedNode(mutation.nodeId)];
  }
  if (isOccurrenceMutation(mutation)) {
    return occurrenceScopes(mutation, occurrenceNodeId);
  }
  switch (mutation.kind) {
    case "text-splice":
    case "text-mark":
      return [canonicalJson(["node-content", mutation.nodeId]), associatedNode(mutation.nodeId)];
    case "value-set":
    case "value-unset":
      return [
        canonicalJson([
          "value",
          mutation.target.kind,
          mutation.target.id,
          mutation.namespace,
          mutation.key,
        ]),
        ...valueAssociation(mutation, occurrenceNodeId),
      ];
    case "schema-apply":
    case "schema-remove":
      return [
        canonicalJson(["schema-application", mutation.nodeId]),
        associatedNode(mutation.nodeId),
        associatedNode(mutation.schemaId),
      ];
    case "schema-field-add":
    case "schema-field-remove":
    case "schema-field-configure":
      return [
        canonicalJson(["schema-template", mutation.schemaId]),
        associatedNode(mutation.schemaId),
        associatedNode(mutation.fieldDefinitionId),
      ];
    case "schema-extension-add":
    case "schema-extension-remove":
      return [
        canonicalJson(["schema-extension", mutation.schemaId]),
        associatedNode(mutation.schemaId),
        associatedNode(mutation.baseSchemaId),
      ];
    case "field-materialize":
      return [
        canonicalJson(["materialized-field", mutation.ownerNodeId, mutation.fieldDefinitionId]),
        associatedNode(mutation.ownerNodeId),
        associatedNode(mutation.fieldDefinitionId),
        associatedNode(mutation.fieldNodeId),
      ];
    case "field-initialize":
      return fieldInitializationScopes(mutation);
  }
}

function occurrenceScopes(
  mutation: OccurrenceMutation,
  occurrenceNodeId: (occurrenceId: string) => string | null,
): readonly string[] {
  if (mutation.kind === "occurrence-create") {
    return [
      structureParent(mutation.parentNodeId),
      ...occurrenceAssociation(mutation.occurrenceId, mutation.nodeId),
    ];
  }
  const association = occurrenceAssociation(
    mutation.occurrenceId,
    occurrenceNodeId(mutation.occurrenceId) ?? undefined,
  );
  if (mutation.kind === "occurrence-restore") {
    return [structureParent(mutation.parentNodeId), ...association];
  }
  if (mutation.kind === "occurrence-delete") {
    return [
      ...(mutation.previousParentNodeId === undefined
        ? [canonicalJson(["structure-occurrence", mutation.occurrenceId])]
        : [structureParent(mutation.previousParentNodeId)]),
      ...association,
    ];
  }
  return [
    ...new Set([
      structureParent(mutation.parentNodeId),
      ...(mutation.previousParentNodeId === undefined
        ? []
        : [structureParent(mutation.previousParentNodeId)]),
      ...association,
    ]),
  ];
}

function isLifecycleMutation(
  mutation: Mutation,
): mutation is Extract<Mutation, { kind: "node-create" | "node-delete" | "node-restore" }> {
  return (
    mutation.kind === "node-create" ||
    mutation.kind === "node-delete" ||
    mutation.kind === "node-restore"
  );
}

function fieldInitializationScopes(
  mutation: Extract<Mutation, { kind: "field-initialize" }>,
): readonly string[] {
  return [
    canonicalJson(["materialized-field", mutation.ownerNodeId, mutation.fieldDefinitionId]),
    associatedNode(mutation.ownerNodeId),
    associatedNode(mutation.schemaId),
    associatedNode(mutation.fieldDefinitionId),
    ...mutation.values.flatMap((value) =>
      value.kind === "reference" ? [associatedNode(value.nodeId)] : [],
    ),
  ];
}

function occurrenceAssociation(occurrenceId: string, nodeId?: string): readonly string[] {
  return [
    canonicalJson(["associated-occurrence", occurrenceId]),
    ...(nodeId ? [associatedNode(nodeId)] : []),
  ];
}

function valueAssociation(
  mutation: ValueMutation,
  occurrenceNodeId: (occurrenceId: string) => string | null,
): readonly string[] {
  if (mutation.target.kind === "node") {
    return [associatedNode(mutation.target.id)];
  }
  return occurrenceAssociation(
    mutation.target.id,
    occurrenceNodeId(mutation.target.id) ?? undefined,
  );
}

function associatedNode(nodeId: string): string {
  return canonicalJson(["associated-node", nodeId]);
}

function structureParent(parentNodeId: string): string {
  return canonicalJson(["structure-parent", parentNodeId]);
}
