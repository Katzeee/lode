import {
  compareFacts,
  stableStringCompare,
  type ContributionFact,
  type ProjectionIdentity,
  type ProjectionPerspective,
} from "../fact/index.js";
import type { Projection, ProjectionSections } from "./projection-types.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import type { SupertagRelations } from "./supertag-relations.js";
import type { TemplateStructureProjection } from "./template-node-projection.js";
import { validateNodeGraph } from "./node-graph.js";
import type { NodeGraphStructure } from "./node-graph-structure.js";
import { nodeLocation, type ProjectedNode } from "./node-graph.js";
import { projectTypedFieldValues } from "./typed-field-values.js";

type ProjectionAssemblyInput = Readonly<{
  perspective: ProjectionPerspective;
  identity: ProjectionIdentity;
  nodes: ReadonlyMap<string, ProjectedNode>;
  occurrences: ReadonlyMap<string, MutableOccurrence>;
  childOccurrences: ReadonlyMap<string, readonly string[]>;
}> &
  Omit<ProjectionSections, "nodes" | "occurrences" | "childOccurrences">;

type ProjectionArtifactAssemblyInput = Readonly<{
  perspective: ProjectionPerspective;
  identity: ProjectionIdentity;
  storedNodes: ReadonlyMap<string, MutableNode>;
  contentNodes: ReadonlyMap<string, MutableNode>;
  templateStructure: TemplateStructureProjection;
  nodeGraphStructure: NodeGraphStructure;
  supertagRelations: SupertagRelations;
  searchExpressions: ProjectionSections["searchExpressions"];
  sharedDefaultViewDefinitions: ProjectionSections["sharedDefaultViewDefinitions"];
  fieldDefinitionConfigurations: ProjectionSections["fieldDefinitionConfigurations"];
  conflictIssues: ProjectionSections["conflictIssues"];
  active: readonly ContributionFact[];
}>;

export function assembleProjectionArtifacts(input: ProjectionArtifactAssemblyInput): Projection {
  validateNodeGraph({
    nodes: input.storedNodes,
    occurrences: input.templateStructure.occurrences,
    childOccurrences: input.templateStructure.childOccurrences,
    nodeOwners: input.nodeGraphStructure.nodeOwners,
    metanodes: input.nodeGraphStructure.metanodes,
  });
  const nodes = projectNodes(
    input.contentNodes,
    input.active,
    input.nodeGraphStructure,
    input.identity.workspaceNodeId,
  );
  const nodeRecord = Object.fromEntries(nodes);
  const occurrenceRecord = Object.fromEntries(input.templateStructure.occurrences);
  return assembleProjection({
    perspective: input.perspective,
    identity: input.identity,
    nodes,
    occurrences: input.templateStructure.occurrences,
    childOccurrences: input.templateStructure.childOccurrences,
    nodeOwners: input.nodeGraphStructure.nodeOwners,
    metanodes: input.nodeGraphStructure.metanodes,
    workspaceSystemNodes: input.nodeGraphStructure.workspaceSystemNodes,
    ...input.supertagRelations,
    searchExpressions: input.searchExpressions,
    sharedDefaultViewDefinitions: input.sharedDefaultViewDefinitions,
    fieldDefinitionConfigurations: input.fieldDefinitionConfigurations,
    typedFieldValues: projectTypedFieldValues({
      materializedFields: input.supertagRelations.materializedFields,
      fieldDefinitionConfigurations: input.fieldDefinitionConfigurations,
      nodes: nodeRecord,
      occurrences: occurrenceRecord,
      nodeOwners: input.nodeGraphStructure.nodeOwners,
      supertagApplications: input.supertagRelations.supertagApplications,
      supertagInstanceSupertags: input.supertagRelations.supertagInstanceSupertags,
    }),
    templateNodeInstances: input.templateStructure.instances,
    conflictIssues: input.conflictIssues,
  });
}

function projectNodes(
  nodes: ReadonlyMap<string, MutableNode>,
  active: readonly ContributionFact[],
  graph: NodeGraphStructure,
  workspaceNodeId: string,
): ReadonlyMap<string, ProjectedNode> {
  const aliases = inlineAliases(active, nodes);
  const locationGraph = { ...graph, nodes: Object.fromEntries(nodes) };
  return new Map(
    [...nodes].map(([nodeId, node]) => [
      nodeId,
      {
        nodeId,
        intrinsicNodeType: node.intrinsicNodeType,
        content: node.content.map((item) => {
          if (item.kind === "text") {
            return item;
          }
          const location = nodeLocation(workspaceNodeId, locationGraph, item.targetNodeId);
          const aliasNodeId = aliases.get(item.id) ?? null;
          return {
            ...item,
            aliasNodeId: aliasNodeId !== null && nodes.has(aliasNodeId) ? aliasNodeId : null,
            targetStatus: location === "absent" ? ("unavailable" as const) : location,
          };
        }),
      },
    ]),
  );
}

function inlineAliases(
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
): ReadonlyMap<string, string> {
  const result = new Map<string, string>(
    [...nodes.values()].flatMap((node) =>
      node.content.flatMap((item) =>
        item.kind === "inline-reference" && item.aliasNodeId ? [[item.id, item.aliasNodeId] as const] : [],
      ),
    ),
  );
  for (const fact of [...active].sort(compareFacts)) {
    const mutation = fact.body.mutation;
    if (mutation.kind === "inline-reference-alias-attach") {
      result.set(mutation.inlineReferenceId, mutation.aliasNodeId);
    } else if (
      mutation.kind === "inline-reference-alias-detach" &&
      result.get(mutation.inlineReferenceId) === mutation.aliasNodeId
    ) {
      result.delete(mutation.inlineReferenceId);
    }
  }
  return result;
}

export function assembleProjection(input: ProjectionAssemblyInput): Projection {
  return {
    perspective: input.perspective,
    identity: input.identity,
    nodes: sortedRecord(input.nodes),
    occurrences: sortedRecord(input.occurrences),
    childOccurrences: Object.fromEntries(
      [...input.childOccurrences]
        .filter(([, ids]) => ids.length > 0)
        .sort(([left], [right]) => stableStringCompare(left, right)),
    ),
    nodeOwners: input.nodeOwners,
    metanodes: input.metanodes,
    workspaceSystemNodes: input.workspaceSystemNodes,
    supertagApplications: input.supertagApplications,
    supertagTemplateNodes: input.supertagTemplateNodes,
    templateFields: input.templateFields,
    optionalFieldContributions: input.optionalFieldContributions,
    templateNodeInstances: input.templateNodeInstances,
    supertagExtensions: input.supertagExtensions,
    supertagInstanceSupertags: input.supertagInstanceSupertags,
    supertagExtensionConflicts: input.supertagExtensionConflicts,
    conflictIssues: input.conflictIssues,
    materializedFields: input.materializedFields,
    effectiveFields: input.effectiveFields,
    optionalFieldSuggestions: input.optionalFieldSuggestions,
    searchExpressions: input.searchExpressions,
    sharedDefaultViewDefinitions: input.sharedDefaultViewDefinitions,
    fieldDefinitionConfigurations: input.fieldDefinitionConfigurations,
    typedFieldValues: input.typedFieldValues,
  };
}

function sortedRecord<T>(values: ReadonlyMap<string, T>): Readonly<Record<string, T>> {
  return Object.fromEntries([...values].sort(([left], [right]) => stableStringCompare(left, right)));
}
