import {
  compareCausalOrder,
  FIELD_CONFIGURATION_DEFINITION_NODE_IDS,
  FIELD_DATATYPE_NODE_IDS,
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  stableStringCompare,
  type FactAction,
  type FactActionOf,
} from "../fact/index.js";
import { activeFieldConfigurationActions } from "./field-configuration-actions.js";
import { nodeLocation } from "./node-graph.js";
import {
  fieldConfigurationProjectionIdentity,
  type FieldConfigurationProjectionIdentity,
} from "./projection-identity.js";
import type { FieldDefinitionConfiguration } from "./projection-types.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import type { WorkspaceSystemNodes } from "./workspace-system-nodes.js";
import { projectTuple } from "./tuple.js";

export function projectFieldDefinitionConfigurations(
  workspaceNodeId: string,
  active: readonly FactAction[],
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
  workspaceSystemNodes: WorkspaceSystemNodes,
): Readonly<Record<string, readonly FieldDefinitionConfiguration[]>> {
  const graph = { nodes: Object.fromEntries(nodes), nodeOwners, workspaceSystemNodes };
  const byDefinition = new Map<string, FieldDefinitionConfiguration[]>();
  for (const action of [...activeFieldConfigurationActions(active)].sort(compareCausalOrder)) {
    const configuration = action.action.configuration;
    const identity = fieldConfigurationProjectionIdentity(action.action.fieldDefinitionId, configuration);
    const occurrence = occurrences.get(identity.configurationOccurrenceId);
    const definitionEndpoint = occurrences.get(identity.definitionOccurrenceId);
    const valueEndpoint = occurrences.get(
      configuration.kind === "initialization-expression" ? identity.expressionOccurrenceId : identity.valueOccurrenceId,
    );
    const optionsEndpoint = occurrences.get(identity.optionsSupertagOccurrenceId);
    const valueNodeId = configurationValueNodeId(action, identity);
    if (
      nodes.get(action.action.fieldDefinitionId)?.intrinsicNodeType !== FIELD_DEFINITION_INTRINSIC_NODE_TYPE ||
      occurrence?.nodeId !== identity.configurationNodeId ||
      occurrence.parentNodeId !== action.action.fieldDefinitionId ||
      nodeOwners[identity.configurationNodeId] !== action.action.fieldDefinitionId ||
      definitionEndpoint?.nodeId !== configurationDefinitionNodeId(configuration.kind) ||
      definitionEndpoint.parentNodeId !== identity.configurationNodeId ||
      nodeOwners[definitionEndpoint.nodeId] === identity.configurationNodeId ||
      valueEndpoint?.nodeId !== valueNodeId ||
      valueEndpoint.parentNodeId !== identity.configurationNodeId ||
      (nodeOwners[valueNodeId] === identity.configurationNodeId) !==
        (configuration.kind === "initialization-expression") ||
      nodeLocation(workspaceNodeId, graph, action.action.fieldDefinitionId) !== "active" ||
      nodeLocation(workspaceNodeId, graph, identity.configurationNodeId) !== "active" ||
      nodeLocation(workspaceNodeId, graph, definitionEndpoint.nodeId) !== "active" ||
      nodeLocation(workspaceNodeId, graph, valueNodeId) !== "active"
    ) {
      continue;
    }
    if (!hasValidOptionsSource(workspaceNodeId, action, optionsEndpoint, nodes, graph)) {
      continue;
    }
    if (
      configuration.kind === "initialization-expression" &&
      !hasInitializationExpressionGraph(
        configuration.expression.sourceFieldDefinitionId,
        identity,
        occurrences,
        childOccurrences,
        nodeOwners,
      )
    ) {
      continue;
    }
    const values = byDefinition.get(action.action.fieldDefinitionId) ?? [];
    values.push(toConfiguration(action, identity));
    byDefinition.set(action.action.fieldDefinitionId, values);
  }
  return orderedConfigurations(byDefinition, childOccurrences);
}

function configurationValueNodeId(
  action: FactActionOf<"field-configuration-set">,
  identity: FieldConfigurationProjectionIdentity,
): string {
  const configuration = action.action.configuration;
  return configuration.kind === "datatype"
    ? configuration.datatypeNodeId
    : configuration.kind === "cardinality"
      ? configuration.cardinalityNodeId
      : configuration.kind === "optionality"
        ? configuration.optionalityNodeId
        : identity.expressionNodeId;
}

function hasValidOptionsSource(
  workspaceNodeId: string,
  action: FactActionOf<"field-configuration-set">,
  endpoint: MutableOccurrence | undefined,
  nodes: ReadonlyMap<string, MutableNode>,
  graph: Parameters<typeof nodeLocation>[1],
): boolean {
  const configuration = action.action.configuration;
  if (
    configuration.kind !== "datatype" ||
    configuration.datatypeNodeId !== FIELD_DATATYPE_NODE_IDS.optionsFromSupertag
  ) {
    return true;
  }
  return (
    configuration.optionsSupertagId !== undefined &&
    endpoint?.nodeId === configuration.optionsSupertagId &&
    endpoint.parentNodeId ===
      fieldConfigurationProjectionIdentity(action.action.fieldDefinitionId, configuration).configurationNodeId &&
    nodes.get(endpoint.nodeId)?.intrinsicNodeType === SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE &&
    graph.nodeOwners[endpoint.nodeId] !== endpoint.parentNodeId &&
    nodeLocation(workspaceNodeId, graph, endpoint.nodeId) === "active"
  );
}

function toConfiguration(
  action: FactActionOf<"field-configuration-set">,
  identity: FieldConfigurationProjectionIdentity,
): FieldDefinitionConfiguration {
  const configuration = action.action.configuration;
  const base = {
    configurationNodeId: identity.configurationNodeId,
    configurationOccurrenceId: identity.configurationOccurrenceId,
    definitionNodeId: configurationDefinitionNodeId(configuration.kind),
    factActionId: action.id,
  };
  if (configuration.kind === "datatype") {
    return {
      ...base,
      kind: "datatype",
      datatypeNodeId: configuration.datatypeNodeId,
      optionsSupertagId: configuration.optionsSupertagId ?? null,
    };
  }
  if (configuration.kind === "cardinality") {
    return { ...base, kind: "cardinality", cardinalityNodeId: configuration.cardinalityNodeId };
  }
  if (configuration.kind === "optionality") {
    return { ...base, kind: "optionality", optionalityNodeId: configuration.optionalityNodeId };
  }
  return {
    ...base,
    kind: "initialization-expression",
    expression: {
      ...configuration.expression,
      expressionNodeId: identity.expressionNodeId,
      expressionOccurrenceId: identity.expressionOccurrenceId,
      sourceFieldDefinitionOccurrenceId: identity.sourceFieldDefinitionOccurrenceId,
      contextNodeId: identity.contextNodeId,
      contextOccurrenceId: identity.contextOccurrenceId,
    },
  };
}

function orderedConfigurations(
  byDefinition: ReadonlyMap<string, FieldDefinitionConfiguration[]>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly FieldDefinitionConfiguration[]>> {
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
              stableStringCompare(left.factActionId, right.factActionId),
          ),
        ] as const;
      }),
  );
}

function configurationDefinitionNodeId(
  kind: FactActionOf<"field-configuration-set">["action"]["configuration"]["kind"],
): string {
  return kind === "datatype"
    ? FIELD_CONFIGURATION_DEFINITION_NODE_IDS.datatype
    : kind === "cardinality"
      ? FIELD_CONFIGURATION_DEFINITION_NODE_IDS.cardinality
      : kind === "optionality"
        ? FIELD_CONFIGURATION_DEFINITION_NODE_IDS.optionality
        : FIELD_CONFIGURATION_DEFINITION_NODE_IDS.initializationExpression;
}

function hasInitializationExpressionGraph(
  sourceFieldDefinitionId: string,
  identity: FieldConfigurationProjectionIdentity,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
): boolean {
  const tuple = projectTuple(identity.expressionNodeId, occurrences, childOccurrences, nodeOwners);
  const sourceEndpoint = tuple.endpoints[0];
  const contextEndpoint = tuple.endpoints[1];
  return (
    sourceEndpoint?.occurrenceId === identity.sourceFieldDefinitionOccurrenceId &&
    sourceEndpoint.nodeId === sourceFieldDefinitionId &&
    !sourceEndpoint.isOwning &&
    contextEndpoint?.occurrenceId === identity.contextOccurrenceId &&
    contextEndpoint.nodeId === identity.contextNodeId &&
    contextEndpoint.isOwning &&
    tuple.ownerNodeId === identity.configurationNodeId &&
    tuple.endpoints.length === 2
  );
}
