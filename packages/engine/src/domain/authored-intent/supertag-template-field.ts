import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type SupertagAction,
} from "../fact/index.js";
import type { InterpretedProjection, TemplateField } from "../reconcile/index.js";

type TemplateFieldAction = Exclude<
  SupertagAction,
  {
    kind:
      | "supertag-application-add"
      | "supertag-membership-remove"
      | "supertag-extension-add"
      | "supertag-extension-remove"
      | "template-member-add"
      | "template-member-remove";
  }
>;

export function validateTemplateFieldIntent(
  action: TemplateFieldAction,
  previous: InterpretedProjection,
  available: InterpretedProjection,
): TemplateFieldAction {
  switch (action.kind) {
    case "template-field-add":
      assertSupertag(available, action.supertagId);
      if (action.fieldDefinition.kind === "existing") {
        assertFieldDefinition(available, action.fieldDefinition.fieldDefinitionId);
      } else if (available.nodes[action.fieldDefinition.fieldDefinitionId] !== undefined) {
        throw new Error("New Template Field Definition identity already exists");
      }
      assertAnchor(available.childOccurrences[action.supertagId] ?? [], action.anchor, "Template Field");
      return action;
    case "template-field-remove":
      if (
        !(previous.templateFields[action.supertagId] ?? []).some(
          (field) => field.fieldDefinitionId === action.fieldDefinitionId,
        )
      ) {
        throw new Error("Template Field is absent from the observed projection");
      }
      return action;
    case "template-field-restore":
      if (findTemplateField(available, action.templateFieldId) === undefined) {
        throw new Error("Restored Template Field is absent from the resulting projection");
      }
      return action;
    case "template-field-visibility-set":
    case "template-field-static-default-set":
      if (findTemplateField(previous, action.templateFieldId) === undefined) {
        throw new Error("Template Field is absent from the observed projection");
      }
      return action;
    case "optional-field-contribution-add":
      assertSupertag(available, action.supertagId);
      assertFieldDefinition(available, action.fieldDefinitionId);
      return action;
    case "optional-field-contribution-remove":
      if (
        !(previous.optionalFieldContributions[action.supertagId] ?? []).some(
          (field) => field.fieldDefinitionId === action.fieldDefinitionId,
        )
      ) {
        throw new Error("Optional Field Contribution is absent from the observed projection");
      }
      return action;
  }
}

function findTemplateField(projection: InterpretedProjection, templateFieldId: string): TemplateField | undefined {
  return Object.values(projection.templateFields)
    .flat()
    .find((field) => field.factActionId === templateFieldId);
}

function assertSupertag(projection: InterpretedProjection, nodeId: string): void {
  if (projection.nodes[nodeId]?.intrinsicNodeType !== SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE) {
    throw new Error("Template Field host is not an active Supertag Definition");
  }
}

function assertFieldDefinition(projection: InterpretedProjection, nodeId: string): void {
  if (projection.nodes[nodeId]?.intrinsicNodeType !== FIELD_DEFINITION_INTRINSIC_NODE_TYPE) {
    throw new Error("Template Field target is not an active Field Definition");
  }
}

function assertAnchor(
  identities: readonly string[],
  anchor: Extract<TemplateFieldAction, { kind: "template-field-add" }>["anchor"],
  label: string,
): void {
  if ([anchor.after, anchor.before].some((id) => id !== null && !identities.includes(id))) {
    throw new Error(`${label} anchor is absent from the observed projection`);
  }
}
