import {
  compareFacts,
  FIELD_CONFIGURATION_DEFINITION_NODE_IDS,
  FIELD_DATATYPE_NODE_IDS,
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  isFieldDefinitionConfigMutation,
  stableStringCompare,
  type ContributionFact,
  type FieldDefinitionConfigMutation,
  type FieldInitializationExpression,
} from "../fact/index.js";
import { nodeLocation } from "./node-graph.js";
import type { FieldDefinitionConfiguration } from "./projection-types.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import type { WorkspaceSystemNodes } from "./workspace-system-nodes.js";
import { projectTuple } from "./tuple.js";

export function projectFieldDefinitionConfigurations(
  workspaceNodeId: string,
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
  workspaceSystemNodes: WorkspaceSystemNodes,
): Readonly<Record<string, readonly FieldDefinitionConfiguration[]>> {
  const graph = { nodes: Object.fromEntries(nodes), nodeOwners, workspaceSystemNodes };
  const facts = [...active].sort(compareFacts);
  const superseded = new Set(
    facts.flatMap((fact) => {
      const mutation = fact.body.mutation;
      return isFieldDefinitionConfigMutation(mutation) ? (mutation.observedValueFactIds ?? []) : [];
    }),
  );
  const byDefinition = new Map<string, FieldDefinitionConfiguration[]>();
  for (const fact of facts) {
    const mutation = fact.body.mutation;
    if (!isFieldDefinitionConfigMutation(mutation) || superseded.has(fact.id)) {
      continue;
    }
    const occurrence = occurrences.get(mutation.configurationOccurrenceId);
    const tuple = projectTuple(mutation.configurationNodeId, occurrences, childOccurrences, nodeOwners);
    const definitionEndpoint = tuple.endpoints[0];
    const valueEndpoint = tuple.endpoints[1];
    const optionsSupertagEndpoint = tuple.endpoints[2];
    const expectedDefinitionNodeId = configurationDefinitionNodeId(mutation.kind);
    const valueNodeId =
      mutation.kind === "field-datatype-configure"
        ? mutation.datatypeNodeId
        : mutation.kind === "field-cardinality-configure"
          ? mutation.cardinalityNodeId
          : mutation.kind === "field-optionality-configure"
            ? mutation.optionalityNodeId
            : mutation.expression.expressionNodeId;
    if (
      nodes.get(mutation.fieldDefinitionId)?.intrinsicNodeType !== FIELD_DEFINITION_INTRINSIC_NODE_TYPE ||
      occurrence?.nodeId !== mutation.configurationNodeId ||
      occurrence.parentNodeId !== mutation.fieldDefinitionId ||
      tuple.ownerNodeId !== mutation.fieldDefinitionId ||
      !hasExpectedEndpointCount(mutation, tuple.endpoints.length) ||
      definitionEndpoint?.nodeId !== expectedDefinitionNodeId ||
      definitionEndpoint.isOwning ||
      valueEndpoint?.nodeId !== valueNodeId ||
      valueEndpoint.isOwning !== (mutation.kind === "field-initialization-expression-configure") ||
      nodeLocation(workspaceNodeId, graph, definitionEndpoint.nodeId) !== "active" ||
      nodeLocation(workspaceNodeId, graph, valueNodeId) !== "active" ||
      nodeLocation(workspaceNodeId, graph, mutation.fieldDefinitionId) !== "active" ||
      nodeLocation(workspaceNodeId, graph, mutation.configurationNodeId) !== "active"
    ) {
      continue;
    }
    if (!hasValidOptionsSource(workspaceNodeId, mutation, optionsSupertagEndpoint, nodes, graph)) {
      continue;
    }
    if (
      mutation.kind === "field-initialization-expression-configure" &&
      (nodes.get(mutation.expression.sourceFieldDefinitionId)?.intrinsicNodeType !==
        FIELD_DEFINITION_INTRINSIC_NODE_TYPE ||
        nodeLocation(workspaceNodeId, graph, mutation.expression.sourceFieldDefinitionId) !== "active" ||
        !hasInitializationExpressionGraph(
          mutation.configurationNodeId,
          mutation.expression,
          occurrences,
          childOccurrences,
          nodeOwners,
        ))
    ) {
      continue;
    }
    const configuration = toConfiguration(
      mutation,
      definitionEndpoint.nodeId,
      fact.id,
      optionsSupertagEndpoint?.nodeId ?? null,
    );
    const values = byDefinition.get(mutation.fieldDefinitionId) ?? [];
    values.push(configuration);
    byDefinition.set(mutation.fieldDefinitionId, values);
  }
  return Object.fromEntries(
    [...byDefinition]
      .sort(([left], [right]) => stableStringCompare(left, right))
      .map(([fieldDefinitionId, configurations]) => {
        const order = childOccurrences.get(fieldDefinitionId) ?? [];
        return [
          fieldDefinitionId,
          configurations.sort(
            (left, right) =>
              order.indexOf(left.configurationOccurrenceId) - order.indexOf(right.configurationOccurrenceId) ||
              stableStringCompare(left.kind, right.kind) ||
              stableStringCompare(left.configurationNodeId, right.configurationNodeId) ||
              stableStringCompare(left.contributionId, right.contributionId),
          ),
        ] as const;
      }),
  );
}

function hasValidOptionsSource(
  workspaceNodeId: string,
  mutation: FieldDefinitionConfigMutation,
  endpoint: ReturnType<typeof projectTuple>["endpoints"][number] | undefined,
  nodes: ReadonlyMap<string, MutableNode>,
  graph: Parameters<typeof nodeLocation>[1],
): boolean {
  if (
    mutation.kind !== "field-datatype-configure" ||
    mutation.datatypeNodeId !== FIELD_DATATYPE_NODE_IDS.optionsFromSupertag
  ) {
    return true;
  }
  return (
    endpoint !== undefined &&
    !endpoint.isOwning &&
    nodes.get(endpoint.nodeId)?.intrinsicNodeType === SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE &&
    nodeLocation(workspaceNodeId, graph, endpoint.nodeId) === "active"
  );
}

function toConfiguration(
  mutation: FieldDefinitionConfigMutation,
  definitionNodeId: string,
  contributionId: string,
  optionsSupertagId: string | null,
): FieldDefinitionConfiguration {
  const identity = {
    configurationNodeId: mutation.configurationNodeId,
    configurationOccurrenceId: mutation.configurationOccurrenceId,
    contributionId,
  };
  if (mutation.kind === "field-datatype-configure") {
    return {
      ...identity,
      kind: "datatype",
      definitionNodeId,
      datatypeNodeId: mutation.datatypeNodeId,
      optionsSupertagId,
    };
  }
  if (mutation.kind === "field-cardinality-configure") {
    return {
      ...identity,
      kind: "cardinality",
      definitionNodeId,
      cardinalityNodeId: mutation.cardinalityNodeId,
    };
  }
  if (mutation.kind === "field-optionality-configure") {
    return {
      ...identity,
      kind: "optionality",
      definitionNodeId,
      optionalityNodeId: mutation.optionalityNodeId,
    };
  }
  return {
    ...identity,
    kind: "initialization-expression",
    definitionNodeId,
    expression: mutation.expression,
  };
}

function hasExpectedEndpointCount(mutation: FieldDefinitionConfigMutation, count: number): boolean {
  return mutation.kind === "field-datatype-configure" &&
    mutation.datatypeNodeId === FIELD_DATATYPE_NODE_IDS.optionsFromSupertag
    ? count === 3
    : count === 2;
}

function configurationDefinitionNodeId(kind: FieldDefinitionConfigMutation["kind"]): string {
  return kind === "field-datatype-configure"
    ? FIELD_CONFIGURATION_DEFINITION_NODE_IDS.datatype
    : kind === "field-cardinality-configure"
      ? FIELD_CONFIGURATION_DEFINITION_NODE_IDS.cardinality
      : kind === "field-optionality-configure"
        ? FIELD_CONFIGURATION_DEFINITION_NODE_IDS.optionality
        : FIELD_CONFIGURATION_DEFINITION_NODE_IDS.initializationExpression;
}

function hasInitializationExpressionGraph(
  configurationNodeId: string,
  expression: FieldInitializationExpression,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
): boolean {
  const expressionOccurrence = occurrences.get(expression.expressionOccurrenceId);
  const sourceOccurrence = occurrences.get(expression.sourceFieldDefinitionOccurrenceId);
  const contextOccurrence = occurrences.get(expression.contextOccurrenceId);
  const operands = childOccurrences.get(expression.expressionNodeId) ?? [];
  const tuple = projectTuple(expression.expressionNodeId, occurrences, childOccurrences, nodeOwners);
  const sourceEndpoint = tuple.endpoints[0];
  const contextEndpoint = tuple.endpoints[1];
  return (
    expressionOccurrence?.nodeId === expression.expressionNodeId &&
    sourceOccurrence?.nodeId === expression.sourceFieldDefinitionId &&
    contextOccurrence?.nodeId === expression.contextNodeId &&
    expressionOccurrence.parentNodeId === configurationNodeId &&
    sourceOccurrence.parentNodeId === expression.expressionNodeId &&
    contextOccurrence.parentNodeId === expression.expressionNodeId &&
    tuple.ownerNodeId === configurationNodeId &&
    tuple.endpoints.length === 2 &&
    sourceEndpoint?.occurrenceId === expression.sourceFieldDefinitionOccurrenceId &&
    !sourceEndpoint.isOwning &&
    contextEndpoint?.occurrenceId === expression.contextOccurrenceId &&
    contextEndpoint.isOwning &&
    operands.includes(expression.sourceFieldDefinitionOccurrenceId) &&
    operands.indexOf(expression.sourceFieldDefinitionOccurrenceId) < operands.indexOf(expression.contextOccurrenceId)
  );
}
