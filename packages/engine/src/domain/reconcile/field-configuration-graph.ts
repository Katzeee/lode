import {
  afterSequenceAnchor as anchorAfter,
  END_SEQUENCE_ANCHOR as end,
  FIELD_CONFIGURATION_DEFINITION_NODE_IDS,
  type FactAction,
  type FactActionId,
  type SequenceAnchor,
} from "../fact/index.js";
import { fieldConfigurationProjectionIdentity } from "./projection-identity.js";

type FieldConfigurationPlacement = Readonly<{
  nodeId: string;
  parentNodeId: string;
  anchor: SequenceAnchor;
  derived: true;
}>;

export function fieldConfigurationPlacementIds(
  action: FactAction,
  activeConfigurationIds: ReadonlySet<FactActionId>,
): readonly string[] {
  const authored = action.action;
  if (authored.kind !== "field-configuration-set" || !activeConfigurationIds.has(action.id)) {
    return [];
  }
  const identity = fieldConfigurationProjectionIdentity(authored.fieldDefinitionId, authored.configuration);
  if (authored.configuration.kind === "initialization-expression") {
    return [
      identity.configurationOccurrenceId,
      identity.definitionOccurrenceId,
      identity.expressionOccurrenceId,
      identity.sourceFieldDefinitionOccurrenceId,
      identity.contextOccurrenceId,
    ];
  }
  return [
    identity.configurationOccurrenceId,
    identity.definitionOccurrenceId,
    identity.valueOccurrenceId,
    ...(authored.configuration.kind === "datatype" && authored.configuration.optionsSupertagId !== undefined
      ? [identity.optionsSupertagOccurrenceId]
      : []),
  ];
}

export function fieldConfigurationPlacement(
  action: FactAction,
  placementId: string,
): FieldConfigurationPlacement | null {
  const authored = action.action;
  if (authored.kind !== "field-configuration-set") {
    return null;
  }
  const configuration = authored.configuration;
  const identity = fieldConfigurationProjectionIdentity(authored.fieldDefinitionId, authored.configuration);
  if (placementId === identity.configurationOccurrenceId) {
    return {
      nodeId: identity.configurationNodeId,
      parentNodeId: authored.fieldDefinitionId,
      anchor: end,
      derived: true,
    };
  }
  if (placementId === identity.definitionOccurrenceId) {
    return {
      nodeId: configurationDefinitionNodeId(configuration.kind),
      parentNodeId: identity.configurationNodeId,
      anchor: end,
      derived: true,
    };
  }
  const afterDefinition = anchorAfter(identity.definitionOccurrenceId);
  if (configuration.kind === "datatype") {
    if (placementId === identity.valueOccurrenceId) {
      return {
        nodeId: configuration.datatypeNodeId,
        parentNodeId: identity.configurationNodeId,
        anchor: afterDefinition,
        derived: true,
      };
    }
    return placementId === identity.optionsSupertagOccurrenceId && configuration.optionsSupertagId !== undefined
      ? {
          nodeId: configuration.optionsSupertagId,
          parentNodeId: identity.configurationNodeId,
          anchor: anchorAfter(identity.valueOccurrenceId),
          derived: true,
        }
      : null;
  }
  if (configuration.kind === "cardinality" && placementId === identity.valueOccurrenceId) {
    return {
      nodeId: configuration.cardinalityNodeId,
      parentNodeId: identity.configurationNodeId,
      anchor: afterDefinition,
      derived: true,
    };
  }
  if (configuration.kind === "optionality" && placementId === identity.valueOccurrenceId) {
    return {
      nodeId: configuration.optionalityNodeId,
      parentNodeId: identity.configurationNodeId,
      anchor: afterDefinition,
      derived: true,
    };
  }
  if (configuration.kind !== "initialization-expression") {
    return null;
  }
  if (placementId === identity.expressionOccurrenceId) {
    return {
      nodeId: identity.expressionNodeId,
      parentNodeId: identity.configurationNodeId,
      anchor: afterDefinition,
      derived: true,
    };
  }
  if (placementId === identity.sourceFieldDefinitionOccurrenceId) {
    return {
      nodeId: configuration.expression.sourceFieldDefinitionId,
      parentNodeId: identity.expressionNodeId,
      anchor: end,
      derived: true,
    };
  }
  return placementId === identity.contextOccurrenceId
    ? {
        nodeId: identity.contextNodeId,
        parentNodeId: identity.expressionNodeId,
        anchor: anchorAfter(identity.sourceFieldDefinitionOccurrenceId),
        derived: true,
      }
    : null;
}

function configurationDefinitionNodeId(
  kind: Extract<FactAction["action"], { kind: "field-configuration-set" }>["configuration"]["kind"],
): string {
  return kind === "datatype"
    ? FIELD_CONFIGURATION_DEFINITION_NODE_IDS.datatype
    : kind === "cardinality"
      ? FIELD_CONFIGURATION_DEFINITION_NODE_IDS.cardinality
      : kind === "optionality"
        ? FIELD_CONFIGURATION_DEFINITION_NODE_IDS.optionality
        : FIELD_CONFIGURATION_DEFINITION_NODE_IDS.initializationExpression;
}
