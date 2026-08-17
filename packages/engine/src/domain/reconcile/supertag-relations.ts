import {
  compareFacts,
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
  stableStringCompare,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type ContributionFact,
} from "../fact/index.js";
import type {
  EffectiveField,
  MaterializedField,
  OptionalFieldSuggestion,
  OptionalFieldContribution,
  SupertagApplication,
  TemplateField,
} from "./projection-types.js";
import type { MutableOccurrence } from "./projection-state.js";
import { supertagExtensionGraph } from "./supertag-extension-graph.js";
import { observedRelations, supertagExtensionEvent } from "./supertag-relation-events.js";
import { boundSupertagTemplateNodes } from "./supertag-template-bindings.js";
import { activeIntrinsicNodeTypes } from "./intrinsic-node-type-declarations.js";
import { filterMaterializedFields, filterRecordOwners } from "./intrinsic-node-type-filters.js";
import { projectMaterializedFields } from "./materialized-fields.js";
import { relationRecord } from "./supertag-relation-records.js";
import { projectTuple } from "./tuple.js";
import { projectFieldAvailability } from "./field-availability.js";
import { projectTemplateFieldGraph } from "./template-fields.js";

export type SupertagRelations = Readonly<{
  supertagApplications: Readonly<Record<string, readonly SupertagApplication[]>>;
  supertagTemplateNodes: Readonly<Record<string, readonly string[]>>;
  templateFields: Readonly<Record<string, readonly TemplateField[]>>;
  optionalFieldContributions: Readonly<Record<string, readonly OptionalFieldContribution[]>>;
  supertagExtensions: Readonly<Record<string, readonly string[]>>;
  supertagInstanceSupertags: Readonly<Record<string, readonly string[]>>;
  supertagExtensionConflicts: Readonly<Record<string, readonly string[]>>;
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>;
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>;
  optionalFieldSuggestions: Readonly<Record<string, readonly OptionalFieldSuggestion[]>>;
}>;

export function deriveSupertagRelations(
  active: readonly ContributionFact[],
  workspaceNodeId: string,
  nodes: Readonly<
    Record<
      string,
      Readonly<{
        intrinsicNodeType: string | null;
        content: readonly Readonly<{ kind: string; value?: string }>[];
      }>
    >
  >,
  existingNodeIds: ReadonlySet<string>,
  knownNodeIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  metanodes: Readonly<Record<string, string>>,
  nodeOwners: Readonly<Record<string, string | null>>,
): SupertagRelations {
  const intrinsicNodeTypes = activeIntrinsicNodeTypes(active);
  const supertagDefinitionIds = new Set(
    [...intrinsicNodeTypes].flatMap(([nodeId, intrinsicNodeType]) =>
      intrinsicNodeType === SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE ? [nodeId] : [],
    ),
  );
  const fieldDefinitionIds = new Set(
    [...intrinsicNodeTypes].flatMap(([nodeId, intrinsicNodeType]) =>
      intrinsicNodeType === FIELD_DEFINITION_INTRINSIC_NODE_TYPE ? [nodeId] : [],
    ),
  );
  const supertagApplications = projectSupertagApplications(
    active,
    existingNodeIds,
    supertagDefinitionIds,
    occurrences,
    childOccurrences,
    metanodes,
    nodeOwners,
  );
  const extensions = observedRelations(active, supertagExtensionEvent, supertagDefinitionIds, supertagDefinitionIds);
  const supertagTemplateNodes = filterRecordOwners(
    boundSupertagTemplateNodes(active, knownNodeIds, occurrences, childOccurrences),
    supertagDefinitionIds,
  );
  const supertagExtensions = relationRecord(extensions);
  const extensionGraph = supertagExtensionGraph(supertagExtensions);
  const materializedFields = filterMaterializedFields(
    projectMaterializedFields(active, existingNodeIds, fieldDefinitionIds, occurrences, childOccurrences, nodeOwners),
    fieldDefinitionIds,
  );
  const { templateFields, optionalFieldContributions } = projectTemplateFieldGraph(
    active,
    workspaceNodeId,
    nodes,
    occurrences,
    childOccurrences,
    nodeOwners,
    metanodes,
  );
  const fieldAvailability = projectFieldAvailability(
    supertagApplications,
    templateFields,
    optionalFieldContributions,
    supertagExtensions,
    materializedFields,
    nodes,
  );
  return {
    supertagApplications,
    supertagTemplateNodes,
    templateFields,
    optionalFieldContributions,
    supertagExtensions,
    supertagInstanceSupertags: extensionGraph.instanceSupertags,
    supertagExtensionConflicts: extensionGraph.conflicts,
    materializedFields,
    ...fieldAvailability,
  };
}

function projectSupertagApplications(
  active: readonly ContributionFact[],
  existingNodeIds: ReadonlySet<string>,
  supertagDefinitionIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  metanodes: Readonly<Record<string, string>>,
  nodeOwners: Readonly<Record<string, string | null>>,
): Readonly<Record<string, readonly SupertagApplication[]>> {
  const byHost = new Map<string, SupertagApplication[]>();
  for (const fact of [...active].sort(compareFacts)) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "supertag-apply") {
      continue;
    }
    const metanodeId = metanodes[mutation.hostNodeId];
    const applicationOccurrence = occurrences.get(mutation.applicationOccurrenceId);
    const tuple = projectTuple(mutation.applicationNodeId, occurrences, childOccurrences, nodeOwners);
    const relationDefinitionEndpoint = tuple.endpoints[0];
    const supertagEndpoint = tuple.endpoints[1];
    if (
      metanodeId === undefined ||
      !existingNodeIds.has(mutation.hostNodeId) ||
      !existingNodeIds.has(mutation.applicationNodeId) ||
      !supertagDefinitionIds.has(mutation.supertagId) ||
      applicationOccurrence?.nodeId !== mutation.applicationNodeId ||
      applicationOccurrence.parentNodeId !== metanodeId ||
      tuple.ownerNodeId !== metanodeId ||
      tuple.endpoints.length !== 2 ||
      relationDefinitionEndpoint?.occurrenceId !== mutation.relationDefinitionOccurrenceId ||
      relationDefinitionEndpoint.nodeId !== NODE_SUPERTAGS_DEFINITION_NODE_ID ||
      relationDefinitionEndpoint.isOwning ||
      supertagEndpoint?.occurrenceId !== mutation.definitionOccurrenceId ||
      supertagEndpoint.nodeId !== mutation.supertagId ||
      supertagEndpoint.isOwning
    ) {
      continue;
    }
    const values = byHost.get(mutation.hostNodeId) ?? [];
    const existingIndex = values.findIndex((value) => value.applicationNodeId === mutation.applicationNodeId);
    if (existingIndex >= 0) {
      values.splice(existingIndex, 1);
    }
    values.push({
      hostNodeId: mutation.hostNodeId,
      supertagId: mutation.supertagId,
      applicationNodeId: mutation.applicationNodeId,
      applicationOccurrenceId: mutation.applicationOccurrenceId,
      relationDefinitionOccurrenceId: mutation.relationDefinitionOccurrenceId,
      definitionOccurrenceId: mutation.definitionOccurrenceId,
      contributionId: fact.id,
    });
    byHost.set(mutation.hostNodeId, values);
  }
  return Object.fromEntries(
    [...byHost]
      .sort(([left], [right]) => stableStringCompare(left, right))
      .map(([hostNodeId, values]) => {
        const metanodeId = metanodes[hostNodeId];
        const order = metanodeId === undefined ? [] : (childOccurrences.get(metanodeId) ?? []);
        return [
          hostNodeId,
          values.sort(
            (left, right) =>
              order.indexOf(left.applicationOccurrenceId) - order.indexOf(right.applicationOccurrenceId) ||
              stableStringCompare(left.applicationNodeId, right.applicationNodeId),
          ),
        ];
      }),
  );
}

export function supertagApplicationTargets(
  applications: Readonly<Record<string, readonly SupertagApplication[]>>,
  ownerNodeIds: ReadonlySet<string>,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    Object.entries(applications).map(([hostNodeId, values]) => [
      hostNodeId,
      [...new Set(values.map((value) => value.supertagId).filter((supertagId) => ownerNodeIds.has(supertagId)))],
    ]),
  );
}
