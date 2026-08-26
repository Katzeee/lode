import {
  compareCausalOrder,
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
  stableStringCompare,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type FactAction,
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
import { observedSupertagExtensions } from "./supertag-relation-events.js";
import { boundSupertagTemplateNodes } from "./supertag-template-bindings.js";
import { filterMaterializedFields, filterRecordOwners } from "./intrinsic-node-type-filters.js";
import { projectMaterializedFields } from "./materialized-fields.js";
import { relationRecord } from "./supertag-relation-records.js";
import { projectTuple } from "./tuple.js";
import { projectFieldAvailability } from "./field-availability.js";
import { projectTemplateFieldGraph } from "./template-fields.js";
import { supertagApplicationStates } from "./supertag-application-graph.js";

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
  active: readonly FactAction[],
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
  const supertagDefinitionIds = new Set(
    Object.entries(nodes).flatMap(([nodeId, node]) =>
      node.intrinsicNodeType === SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE ? [nodeId] : [],
    ),
  );
  const fieldDefinitionIds = new Set(
    Object.entries(nodes).flatMap(([nodeId, node]) =>
      node.intrinsicNodeType === FIELD_DEFINITION_INTRINSIC_NODE_TYPE ? [nodeId] : [],
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
  const extensions = observedSupertagExtensions(active, supertagDefinitionIds, supertagDefinitionIds);
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
  active: readonly FactAction[],
  existingNodeIds: ReadonlySet<string>,
  supertagDefinitionIds: ReadonlySet<string>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  metanodes: Readonly<Record<string, string>>,
  nodeOwners: Readonly<Record<string, string | null>>,
): Readonly<Record<string, readonly SupertagApplication[]>> {
  const byHost = new Map<string, SupertagApplication[]>();
  for (const state of [...supertagApplicationStates(active)].sort((left, right) =>
    compareCausalOrder(left.addition, right.addition),
  )) {
    if (state.removed) {
      continue;
    }
    const fact = state.addition;
    const authoredAction = fact.action;
    const identity = state.identity;
    const metanodeId = metanodes[authoredAction.hostNodeId];
    const applicationOccurrence = occurrences.get(identity.applicationOccurrenceId);
    const tuple = projectTuple(identity.applicationNodeId, occurrences, childOccurrences, nodeOwners);
    const relationDefinitionEndpoint = tuple.endpoints[0];
    const supertagEndpoint = tuple.endpoints[1];
    if (
      metanodeId === undefined ||
      !existingNodeIds.has(authoredAction.hostNodeId) ||
      !existingNodeIds.has(identity.applicationNodeId) ||
      !supertagDefinitionIds.has(authoredAction.supertagId) ||
      applicationOccurrence?.nodeId !== identity.applicationNodeId ||
      applicationOccurrence?.parentNodeId !== metanodeId ||
      tuple.ownerNodeId !== metanodeId ||
      tuple.endpoints.length !== 2 ||
      relationDefinitionEndpoint?.occurrenceId !== identity.relationDefinitionOccurrenceId ||
      relationDefinitionEndpoint?.nodeId !== NODE_SUPERTAGS_DEFINITION_NODE_ID ||
      relationDefinitionEndpoint?.isOwning ||
      supertagEndpoint?.occurrenceId !== identity.definitionOccurrenceId ||
      supertagEndpoint?.nodeId !== authoredAction.supertagId ||
      supertagEndpoint?.isOwning
    ) {
      continue;
    }
    const values = byHost.get(authoredAction.hostNodeId) ?? [];
    const existingIndex = values.findIndex((value) => value.applicationNodeId === identity.applicationNodeId);
    if (existingIndex >= 0) {
      values.splice(existingIndex, 1);
    }
    values.push({
      hostNodeId: authoredAction.hostNodeId,
      supertagId: authoredAction.supertagId,
      applicationNodeId: identity.applicationNodeId,
      applicationOccurrenceId: identity.applicationOccurrenceId,
      relationDefinitionOccurrenceId: identity.relationDefinitionOccurrenceId,
      definitionOccurrenceId: identity.definitionOccurrenceId,
      factActionId: fact.id,
    });
    byHost.set(authoredAction.hostNodeId, values);
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
