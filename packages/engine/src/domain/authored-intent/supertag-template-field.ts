import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  workspaceSchemaNodeId,
  type SupertagAction,
} from "../fact/index.js";
import type { InterpretedProjection, TemplateField } from "../reconcile/index.js";
import { AuthoredIntentViolation } from "./contract.js";

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

export function assertTemplateFieldIntent(
  action: TemplateFieldAction,
  previous: InterpretedProjection,
  available: InterpretedProjection,
): void {
  switch (action.kind) {
    case "template-field-add":
      assertSupertag(available, action.supertagId);
      if (action.fieldDefinition.kind === "existing") {
        assertDiscoverableFieldDefinition(available, action.fieldDefinition.fieldDefinitionId);
      } else if (available.nodes[action.fieldDefinition.fieldDefinitionId] !== undefined) {
        throw new AuthoredIntentViolation("New Template Field Definition identity already exists");
      }
      assertFieldDefinitionIsNotExposed(available, action.supertagId, action.fieldDefinition.fieldDefinitionId);
      assertAnchor(available.childOccurrences[action.supertagId] ?? [], action.anchor, "Template Field");
      return;
    case "template-field-remove":
      if (
        !(previous.templateFields[action.supertagId] ?? []).some(
          (field) => field.fieldDefinitionId === action.fieldDefinitionId,
        )
      ) {
        throw new AuthoredIntentViolation("Template Field is absent from the observed projection");
      }
      return;
    case "template-field-restore":
      if (findTemplateField(available, action.templateFieldId) === undefined) {
        throw new AuthoredIntentViolation("Restored Template Field is absent from the resulting projection");
      }
      return;
    case "template-field-visibility-set":
    case "template-field-static-default-set":
      if (findTemplateField(previous, action.templateFieldId) === undefined) {
        throw new AuthoredIntentViolation("Template Field is absent from the observed projection");
      }
      return;
    case "optional-field-contribution-add":
      assertSupertag(available, action.supertagId, "Optional Field");
      assertDiscoverableFieldDefinition(available, action.fieldDefinitionId, "Optional Field");
      assertFieldDefinitionIsNotExposed(available, action.supertagId, action.fieldDefinitionId);
      assertAnchor(available.childOccurrences[action.supertagId] ?? [], action.anchor, "Optional Field");
      return;
    case "optional-field-contribution-remove":
      if (
        !(previous.optionalFieldContributions[action.supertagId] ?? []).some(
          (field) => field.fieldDefinitionId === action.fieldDefinitionId,
        )
      ) {
        throw new AuthoredIntentViolation("Optional Field Contribution is absent from the observed projection");
      }
      return;
    default:
      action satisfies never;
  }
}

function findTemplateField(projection: InterpretedProjection, templateFieldId: string): TemplateField | undefined {
  return Object.values(projection.templateFields)
    .flat()
    .find((field) => field.factActionId === templateFieldId);
}

function assertSupertag(projection: InterpretedProjection, nodeId: string, label = "Template Field"): void {
  if (projection.nodes[nodeId]?.intrinsicNodeType !== SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE) {
    throw new AuthoredIntentViolation(`${label} host is not an active Supertag Definition`);
  }
}

function assertDiscoverableFieldDefinition(
  projection: InterpretedProjection,
  nodeId: string,
  label = "Template Field",
): void {
  if (
    projection.nodes[nodeId]?.intrinsicNodeType !== FIELD_DEFINITION_INTRINSIC_NODE_TYPE ||
    projection.nodeOwners[nodeId] !== workspaceSchemaNodeId(projection.identity.workspaceNodeId)
  ) {
    throw new AuthoredIntentViolation(`${label} endpoint is not a discoverable Field Definition`);
  }
}

function assertFieldDefinitionIsNotExposed(
  projection: InterpretedProjection,
  supertagId: string,
  fieldDefinitionId: string,
): void {
  if (
    (projection.templateFields[supertagId] ?? []).some((field) => field.fieldDefinitionId === fieldDefinitionId) ||
    (projection.optionalFieldContributions[supertagId] ?? []).some(
      (field) => field.fieldDefinitionId === fieldDefinitionId,
    )
  ) {
    throw new AuthoredIntentViolation("Supertag already exposes this Field Definition");
  }
}

function assertAnchor(
  identities: readonly string[],
  anchor: Extract<TemplateFieldAction, { kind: "template-field-add" }>["anchor"],
  label: string,
): void {
  if ([anchor.after, anchor.before].some((id) => id !== null && !identities.includes(id))) {
    throw new AuthoredIntentViolation(`${label} anchor is absent from the observed projection`);
  }
}
