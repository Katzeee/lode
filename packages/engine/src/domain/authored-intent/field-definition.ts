import {
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_DATATYPE_NODE_IDS,
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  FIELD_OPTIONALITY_NODE_IDS,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  graphActionKindsInFamily,
} from "../fact/index.js";
import type { AuthoredIntentFamily } from "./policy.js";

const ACTION_KINDS = graphActionKindsInFamily("fieldDefinition");

export const fieldDefinitionAuthoredIntent = {
  key: "field-definition",
  actionKinds: ACTION_KINDS,
  validate(action, context) {
    const available = context.projections().available;
    if (available.nodes[action.fieldDefinitionId]?.intrinsicNodeType !== FIELD_DEFINITION_INTRINSIC_NODE_TYPE) {
      throw new Error("Field configuration host is not an active Field Definition Node");
    }
    if (action.kind !== "field-configuration-set") {
      return action;
    }
    const configuration = action.configuration;
    if (configuration.kind === "datatype") {
      if (!(Object.values(FIELD_DATATYPE_NODE_IDS) as readonly string[]).includes(configuration.datatypeNodeId)) {
        throw new Error("Field Datatype is not a built-in System Definition");
      }
      if (
        configuration.optionsSupertagId !== undefined &&
        available.nodes[configuration.optionsSupertagId]?.intrinsicNodeType !== SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE
      ) {
        throw new Error("Options source is not an active Supertag Definition");
      }
    } else if (
      configuration.kind === "cardinality" &&
      !(Object.values(FIELD_CARDINALITY_NODE_IDS) as readonly string[]).includes(configuration.cardinalityNodeId)
    ) {
      throw new Error("Field Cardinality is not a built-in System Definition");
    } else if (
      configuration.kind === "optionality" &&
      !(Object.values(FIELD_OPTIONALITY_NODE_IDS) as readonly string[]).includes(configuration.optionalityNodeId)
    ) {
      throw new Error("Field Optionality is not a built-in System Definition");
    } else if (
      configuration.kind === "initialization-expression" &&
      available.nodes[configuration.expression.sourceFieldDefinitionId]?.intrinsicNodeType !==
        FIELD_DEFINITION_INTRINSIC_NODE_TYPE
    ) {
      throw new Error("Initialization source is not an active Field Definition Node");
    }
    return action;
  },
} satisfies AuthoredIntentFamily<(typeof ACTION_KINDS)[number]>;
