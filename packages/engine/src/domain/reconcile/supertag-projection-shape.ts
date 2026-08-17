import { array, exact, nonempty, object } from "../../shape-validation/index.js";
import type {
  MaterializedField,
  OptionalFieldContribution,
  ProjectionSectionValue,
  SupertagApplication,
  TemplateField,
} from "./projection-types.js";
import { parseTypedFieldValue } from "./typed-field-value-shape.js";
import { parseEffectiveField, parseOptionalFieldSuggestion } from "./effective-field-shape.js";

type SupertagProjectionSection =
  | "supertagApplications"
  | "supertagTemplateNodes"
  | "supertagExtensions"
  | "supertagInstanceSupertags"
  | "supertagExtensionConflicts"
  | "templateFields"
  | "optionalFieldContributions"
  | "effectiveFields"
  | "optionalFieldSuggestions"
  | "materializedFields"
  | "typedFieldValues";

export function parseSupertagProjectionSectionValue(
  section: SupertagProjectionSection,
  value: unknown,
): ProjectionSectionValue<SupertagProjectionSection> {
  switch (section) {
    case "materializedFields":
      return array(value, "Materialized Fields", materializedField);
    case "typedFieldValues":
      return array(value, "Typed Field Values", parseTypedFieldValue);
    case "supertagApplications":
      return array(value, "Supertag Applications", supertagApplication);
    case "templateFields":
      return array(value, "Template Fields", templateField);
    case "optionalFieldContributions":
      return array(value, "Optional Field Contributions", optionalFieldContribution);
    case "effectiveFields":
      return array(value, "Effective Fields", parseEffectiveField);
    case "optionalFieldSuggestions":
      return array(value, "Optional Field Suggestions", parseOptionalFieldSuggestion);
    case "supertagTemplateNodes":
    case "supertagExtensions":
    case "supertagInstanceSupertags":
    case "supertagExtensionConflicts":
      return identities(value);
  }
}

function templateField(value: unknown): TemplateField {
  const item = object(value, "Template Field");
  exact(
    item,
    [
      "supertagId",
      "templateFieldNodeId",
      "templateFieldOccurrenceId",
      "fieldDefinitionId",
      "definitionOccurrenceId",
      "staticDefaultValueNodeId",
      "staticDefaultValueOccurrenceId",
      "fieldDefinitionOwner",
      "contributionId",
      "visibility",
      "visibilityCandidates",
      "visibilityConflicted",
    ],
    "Template Field",
  );
  if (item.fieldDefinitionOwner !== "template-field" && item.fieldDefinitionOwner !== "workspace-schema") {
    throw new Error("Template Field Definition owner is invalid");
  }
  if (item.visibility !== "normal" && item.visibility !== "pinned") {
    throw new Error("Template Field visibility is invalid");
  }
  if (typeof item.visibilityConflicted !== "boolean") {
    throw new Error("Template Field visibility conflict flag is invalid");
  }
  return {
    supertagId: identity(item.supertagId),
    templateFieldNodeId: identity(item.templateFieldNodeId),
    templateFieldOccurrenceId: identity(item.templateFieldOccurrenceId),
    fieldDefinitionId: identity(item.fieldDefinitionId),
    definitionOccurrenceId: identity(item.definitionOccurrenceId),
    staticDefaultValueNodeId: identity(item.staticDefaultValueNodeId),
    staticDefaultValueOccurrenceId: identity(item.staticDefaultValueOccurrenceId),
    fieldDefinitionOwner: item.fieldDefinitionOwner,
    contributionId: identity(item.contributionId),
    visibility: item.visibility,
    visibilityCandidates: array(item.visibilityCandidates, "Template Field visibility candidates", (candidateValue) => {
      const candidate = object(candidateValue, "Template Field visibility candidate");
      exact(candidate, ["visibility", "contributionId"], "Template Field visibility candidate");
      if (candidate.visibility !== "normal" && candidate.visibility !== "pinned") {
        throw new Error("Template Field visibility candidate is invalid");
      }
      return { visibility: candidate.visibility, contributionId: identity(candidate.contributionId) };
    }),
    visibilityConflicted: item.visibilityConflicted,
  };
}

function optionalFieldContribution(value: unknown): OptionalFieldContribution {
  const item = object(value, "Optional Field Contribution");
  exact(
    item,
    [
      "supertagId",
      "fieldNurseryNodeId",
      "fieldNurseryOccurrenceId",
      "nurseryDefinitionOccurrenceId",
      "nurseryValueNodeId",
      "nurseryValueOccurrenceId",
      "contributionNodeId",
      "contributionOccurrenceId",
      "fieldDefinitionId",
      "definitionOccurrenceId",
      "valueNodeId",
      "valueOccurrenceId",
      "contributionId",
    ],
    "Optional Field Contribution",
  );
  return {
    supertagId: identity(item.supertagId),
    fieldNurseryNodeId: identity(item.fieldNurseryNodeId),
    fieldNurseryOccurrenceId: identity(item.fieldNurseryOccurrenceId),
    nurseryDefinitionOccurrenceId: identity(item.nurseryDefinitionOccurrenceId),
    nurseryValueNodeId: identity(item.nurseryValueNodeId),
    nurseryValueOccurrenceId: identity(item.nurseryValueOccurrenceId),
    contributionNodeId: identity(item.contributionNodeId),
    contributionOccurrenceId: identity(item.contributionOccurrenceId),
    fieldDefinitionId: identity(item.fieldDefinitionId),
    definitionOccurrenceId: identity(item.definitionOccurrenceId),
    valueNodeId: identity(item.valueNodeId),
    valueOccurrenceId: identity(item.valueOccurrenceId),
    contributionId: identity(item.contributionId),
  };
}

function supertagApplication(value: unknown): SupertagApplication {
  const item = object(value, "Supertag Application");
  exact(
    item,
    [
      "hostNodeId",
      "supertagId",
      "applicationNodeId",
      "applicationOccurrenceId",
      "relationDefinitionOccurrenceId",
      "definitionOccurrenceId",
      "contributionId",
    ],
    "Supertag Application",
  );
  return {
    hostNodeId: identity(item.hostNodeId),
    supertagId: identity(item.supertagId),
    applicationNodeId: identity(item.applicationNodeId),
    applicationOccurrenceId: identity(item.applicationOccurrenceId),
    relationDefinitionOccurrenceId: identity(item.relationDefinitionOccurrenceId),
    definitionOccurrenceId: identity(item.definitionOccurrenceId),
    contributionId: identity(item.contributionId),
  };
}

function materializedField(value: unknown): MaterializedField {
  const item = object(value, "Materialized Field");
  exact(
    item,
    [
      "ownerNodeId",
      "fieldDefinitionId",
      "fieldNodeId",
      "fieldOccurrenceId",
      "definitionOccurrenceId",
      "valueOccurrenceIds",
    ],
    "Materialized Field",
  );
  return {
    ownerNodeId: identity(item.ownerNodeId),
    fieldDefinitionId: identity(item.fieldDefinitionId),
    fieldNodeId: identity(item.fieldNodeId),
    fieldOccurrenceId: identity(item.fieldOccurrenceId),
    definitionOccurrenceId: identity(item.definitionOccurrenceId),
    valueOccurrenceIds: identities(item.valueOccurrenceIds),
  };
}

function identities(value: unknown): string[] {
  return array(value, "Identities", identity);
}

function identity(value: unknown): string {
  return nonempty(value, "Identity");
}
