import {
  compareFacts,
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  FIELD_INTRINSIC_NODE_TYPE,
  OPTIONAL_FIELDS_DEFINITION_NODE_ID,
  stableStringCompare,
  workspaceSchemaNodeId,
  type ContributionFact,
} from "../fact/index.js";
import type { MutableOccurrence } from "./projection-state.js";
import type { OptionalFieldContribution, TemplateField } from "./projection-types.js";
import { projectTuple } from "./tuple.js";

type TemplateFieldGraph = Readonly<{
  templateFields: Readonly<Record<string, readonly TemplateField[]>>;
  optionalFieldContributions: Readonly<Record<string, readonly OptionalFieldContribution[]>>;
}>;

type NodeIdentityProjection = Readonly<Record<string, Readonly<{ intrinsicNodeType: string | null }>>>;

export function projectTemplateFieldGraph(
  active: readonly ContributionFact[],
  workspaceNodeId: string,
  nodes: NodeIdentityProjection,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
  metanodes: Readonly<Record<string, string>>,
): TemplateFieldGraph {
  return {
    templateFields: projectTemplateFields(active, workspaceNodeId, nodes, occurrences, childOccurrences, nodeOwners),
    optionalFieldContributions: projectOptionalFieldContributions(
      active,
      workspaceNodeId,
      nodes,
      occurrences,
      childOccurrences,
      nodeOwners,
      metanodes,
    ),
  };
}

function projectTemplateFields(
  active: readonly ContributionFact[],
  workspaceNodeId: string,
  nodes: NodeIdentityProjection,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
): Readonly<Record<string, readonly TemplateField[]>> {
  const byIdentity = new Map<string, TemplateField>();
  const visibilityFacts = active.filter(
    (fact) => fact.body.mutation.kind === "supertag-template-field-visibility-configure",
  );
  const supersededVisibilityFacts = new Set(
    visibilityFacts.flatMap((fact) => {
      const mutation = fact.body.mutation;
      return mutation.kind === "supertag-template-field-visibility-configure"
        ? (mutation.observedVisibilityFactIds ?? [])
        : [];
    }),
  );
  for (const fact of [...active].sort(compareFacts)) {
    const mutation = fact.body.mutation;
    if (
      mutation.kind !== "supertag-template-field-attach" &&
      mutation.kind !== "supertag-template-field-existing-attach"
    ) {
      continue;
    }
    const placement = occurrences.get(mutation.templateFieldOccurrenceId);
    const tuple = projectTuple(mutation.templateFieldNodeId, occurrences, childOccurrences, nodeOwners);
    const definition = tuple.endpoints[0];
    const defaultValue = tuple.endpoints[1];
    const definitionOwner = nodeOwners[mutation.fieldDefinitionId];
    const fieldDefinitionOwner =
      definitionOwner === mutation.templateFieldNodeId
        ? "template-field"
        : definitionOwner === workspaceSchemaNodeId(workspaceNodeId)
          ? "workspace-schema"
          : null;
    if (
      nodes[mutation.supertagId]?.intrinsicNodeType !== "supertag-definition" ||
      nodes[mutation.templateFieldNodeId]?.intrinsicNodeType !== FIELD_INTRINSIC_NODE_TYPE ||
      nodes[mutation.fieldDefinitionId]?.intrinsicNodeType !== FIELD_DEFINITION_INTRINSIC_NODE_TYPE ||
      nodes[mutation.staticDefaultValueNodeId] === undefined ||
      placement?.nodeId !== mutation.templateFieldNodeId ||
      placement.parentNodeId !== mutation.supertagId ||
      tuple.ownerNodeId !== mutation.supertagId ||
      tuple.endpoints.length !== 2 ||
      definition?.occurrenceId !== mutation.definitionOccurrenceId ||
      definition.nodeId !== mutation.fieldDefinitionId ||
      defaultValue?.occurrenceId !== mutation.staticDefaultValueOccurrenceId ||
      defaultValue.nodeId !== mutation.staticDefaultValueNodeId ||
      !defaultValue.isOwning ||
      fieldDefinitionOwner === null ||
      definition.isOwning !== (fieldDefinitionOwner === "template-field")
    ) {
      continue;
    }
    const visibilityCandidates = visibilityFacts.flatMap((visibilityFact) => {
      const visibilityMutation = visibilityFact.body.mutation;
      return visibilityMutation.kind === "supertag-template-field-visibility-configure" &&
        visibilityMutation.supertagId === mutation.supertagId &&
        visibilityMutation.templateFieldNodeId === mutation.templateFieldNodeId &&
        visibilityMutation.fieldDefinitionId === mutation.fieldDefinitionId &&
        !supersededVisibilityFacts.has(visibilityFact.id)
        ? [{ visibility: visibilityMutation.visibility, contributionId: visibilityFact.id }]
        : [];
    });
    const candidateVisibilities = new Set(visibilityCandidates.map((candidate) => candidate.visibility));
    byIdentity.set(mutation.templateFieldNodeId, {
      supertagId: mutation.supertagId,
      templateFieldNodeId: mutation.templateFieldNodeId,
      templateFieldOccurrenceId: mutation.templateFieldOccurrenceId,
      fieldDefinitionId: mutation.fieldDefinitionId,
      definitionOccurrenceId: mutation.definitionOccurrenceId,
      staticDefaultValueNodeId: mutation.staticDefaultValueNodeId,
      staticDefaultValueOccurrenceId: mutation.staticDefaultValueOccurrenceId,
      fieldDefinitionOwner,
      contributionId: fact.id,
      visibility: visibilityCandidates.some((candidate) => candidate.visibility === "pinned") ? "pinned" : "normal",
      visibilityCandidates,
      visibilityConflicted: candidateVisibilities.size > 1,
    });
  }
  return orderedBySupertag([...byIdentity.values()], childOccurrences);
}

function projectOptionalFieldContributions(
  active: readonly ContributionFact[],
  workspaceNodeId: string,
  nodes: NodeIdentityProjection,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
  metanodes: Readonly<Record<string, string>>,
): Readonly<Record<string, readonly OptionalFieldContribution[]>> {
  const byIdentity = new Map<string, OptionalFieldContribution>();
  for (const fact of [...active].sort(compareFacts)) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "supertag-optional-field-contribution-attach") {
      continue;
    }
    const metanodeId = metanodes[mutation.supertagId];
    const nurseryPlacement = occurrences.get(mutation.fieldNurseryOccurrenceId);
    const nursery = projectTuple(mutation.fieldNurseryNodeId, occurrences, childOccurrences, nodeOwners);
    const nurseryDefinition = nursery.endpoints[0];
    const nurseryValue = nursery.endpoints[1];
    const contributionPlacement = occurrences.get(mutation.contributionOccurrenceId);
    const contribution = projectTuple(mutation.contributionNodeId, occurrences, childOccurrences, nodeOwners);
    const definition = contribution.endpoints[0];
    const value = contribution.endpoints[1];
    if (
      metanodeId === undefined ||
      nodes[mutation.supertagId]?.intrinsicNodeType !== "supertag-definition" ||
      nodes[mutation.fieldDefinitionId]?.intrinsicNodeType !== FIELD_DEFINITION_INTRINSIC_NODE_TYPE ||
      nodeOwners[mutation.fieldDefinitionId] !== workspaceSchemaNodeId(workspaceNodeId) ||
      nurseryPlacement?.nodeId !== mutation.fieldNurseryNodeId ||
      nurseryPlacement.parentNodeId !== metanodeId ||
      nursery.ownerNodeId !== metanodeId ||
      nursery.endpoints.length !== 2 ||
      nurseryDefinition?.occurrenceId !== mutation.nurseryDefinitionOccurrenceId ||
      nurseryDefinition.nodeId !== OPTIONAL_FIELDS_DEFINITION_NODE_ID ||
      nurseryDefinition.isOwning ||
      nurseryValue?.occurrenceId !== mutation.nurseryValueOccurrenceId ||
      nurseryValue.nodeId !== mutation.nurseryValueNodeId ||
      !nurseryValue.isOwning ||
      contributionPlacement?.nodeId !== mutation.contributionNodeId ||
      contributionPlacement.parentNodeId !== mutation.nurseryValueNodeId ||
      contribution.ownerNodeId !== mutation.nurseryValueNodeId ||
      contribution.endpoints.length !== 2 ||
      definition?.occurrenceId !== mutation.definitionOccurrenceId ||
      definition.nodeId !== mutation.fieldDefinitionId ||
      definition.isOwning ||
      value?.occurrenceId !== mutation.valueOccurrenceId ||
      value.nodeId !== mutation.valueNodeId ||
      !value.isOwning
    ) {
      continue;
    }
    byIdentity.set(mutation.contributionNodeId, {
      supertagId: mutation.supertagId,
      fieldNurseryNodeId: mutation.fieldNurseryNodeId,
      fieldNurseryOccurrenceId: mutation.fieldNurseryOccurrenceId,
      nurseryDefinitionOccurrenceId: mutation.nurseryDefinitionOccurrenceId,
      nurseryValueNodeId: mutation.nurseryValueNodeId,
      nurseryValueOccurrenceId: mutation.nurseryValueOccurrenceId,
      contributionNodeId: mutation.contributionNodeId,
      contributionOccurrenceId: mutation.contributionOccurrenceId,
      fieldDefinitionId: mutation.fieldDefinitionId,
      definitionOccurrenceId: mutation.definitionOccurrenceId,
      valueNodeId: mutation.valueNodeId,
      valueOccurrenceId: mutation.valueOccurrenceId,
      contributionId: fact.id,
    });
  }
  return orderedOptionalBySupertag([...byIdentity.values()], childOccurrences);
}

function orderedBySupertag(
  values: readonly TemplateField[],
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly TemplateField[]>> {
  const supertagIds = unique(values.map((value) => value.supertagId)).sort(stableStringCompare);
  return Object.fromEntries(
    supertagIds.map((supertagId) => {
      const order = childOccurrences.get(supertagId) ?? [];
      return [
        supertagId,
        values
          .filter((value) => value.supertagId === supertagId)
          .sort(
            (left, right) =>
              order.indexOf(left.templateFieldOccurrenceId) - order.indexOf(right.templateFieldOccurrenceId) ||
              stableStringCompare(left.templateFieldNodeId, right.templateFieldNodeId),
          ),
      ];
    }),
  );
}

function orderedOptionalBySupertag(
  values: readonly OptionalFieldContribution[],
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly OptionalFieldContribution[]>> {
  const supertagIds = unique(values.map((value) => value.supertagId)).sort(stableStringCompare);
  return Object.fromEntries(
    supertagIds.map((supertagId) => [
      supertagId,
      values
        .filter((value) => value.supertagId === supertagId)
        .sort((left, right) => {
          const leftOrder = childOccurrences.get(left.nurseryValueNodeId) ?? [];
          const rightOrder = childOccurrences.get(right.nurseryValueNodeId) ?? [];
          return (
            (left.fieldNurseryNodeId === right.fieldNurseryNodeId
              ? leftOrder.indexOf(left.contributionOccurrenceId) - rightOrder.indexOf(right.contributionOccurrenceId)
              : stableStringCompare(left.fieldNurseryNodeId, right.fieldNurseryNodeId)) ||
            stableStringCompare(left.contributionNodeId, right.contributionNodeId)
          );
        }),
    ]),
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
