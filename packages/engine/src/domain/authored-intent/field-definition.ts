import {
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_DATATYPE_NODE_IDS,
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  FIELD_OPTIONALITY_NODE_IDS,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  graphActionKindsInFamily,
} from "../fact/index.js";
import { AuthoredIntentViolation, type AuthoredIntentFamily } from "./contract.js";

const ACTION_KINDS = graphActionKindsInFamily("fieldDefinition");

export const fieldDefinitionAuthoredIntent = {
  key: "field-definition",
  actionKinds: ACTION_KINDS,
  assert(action, context) {
    const { available } = context;
    if (available.nodes[action.fieldDefinitionId]?.intrinsicNodeType !== FIELD_DEFINITION_INTRINSIC_NODE_TYPE) {
      throw new AuthoredIntentViolation("Field configuration host is not an active Field Definition Node");
    }
    if (action.kind !== "field-configuration-set") {
      return;
    }
    const configuration = action.configuration;
    if (configuration.kind === "datatype") {
      if (!(Object.values(FIELD_DATATYPE_NODE_IDS) as readonly string[]).includes(configuration.datatypeNodeId)) {
        throw new AuthoredIntentViolation("Field Datatype is not a built-in System Definition");
      }
      if (
        configuration.optionsSupertagId !== undefined &&
        available.nodes[configuration.optionsSupertagId]?.intrinsicNodeType !== SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE
      ) {
        throw new AuthoredIntentViolation("Options source is not an active Supertag Definition");
      }
    } else if (
      configuration.kind === "cardinality" &&
      !(Object.values(FIELD_CARDINALITY_NODE_IDS) as readonly string[]).includes(configuration.cardinalityNodeId)
    ) {
      throw new AuthoredIntentViolation("Field Cardinality is not a built-in System Definition");
    } else if (
      configuration.kind === "optionality" &&
      !(Object.values(FIELD_OPTIONALITY_NODE_IDS) as readonly string[]).includes(configuration.optionalityNodeId)
    ) {
      throw new AuthoredIntentViolation("Field Optionality is not a built-in System Definition");
    } else if (
      configuration.kind === "initialization-expression" &&
      configuration.expression.sourceFieldDefinitionId !== action.fieldDefinitionId
    ) {
      throw new AuthoredIntentViolation("Ancestor Field initialization reads the configured Field Definition");
    }
  },
} satisfies AuthoredIntentFamily<(typeof ACTION_KINDS)[number]>;
