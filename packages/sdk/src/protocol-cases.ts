import type { EditMutation as ProtocolEditMutation } from "@lode/protocol/dto/edit";
import type {
  EngineCommand as ProtocolEngineCommand,
  EngineQuery as ProtocolEngineQuery,
  QueryResult as ProtocolQueryResult,
  WriteResult as ProtocolWriteResult,
} from "@lode/protocol/dto/engine";
import type {
  ConflictIssue as ProtocolConflictIssue,
  DecisionEffect as ProtocolDecisionEffect,
} from "@lode/protocol/dto/review";
import type { EditMutation } from "./edit.js";
import type { EngineCommand, EngineQuery, WriteResult } from "./contract.js";
import type { ConflictIssue, DecisionEffect } from "./review.js";

type DecodedEngineCommand = ReturnType<typeof ProtocolEngineCommand.decode>;
type DecodedEngineQuery = ReturnType<typeof ProtocolEngineQuery.decode>;
type DecodedQueryResult = ReturnType<typeof ProtocolQueryResult.decode>;
type DecodedEditMutation = ReturnType<typeof ProtocolEditMutation.decode>;
type DecodedWriteResult = ReturnType<typeof ProtocolWriteResult.decode>;
type DecodedDecisionEffect = ReturnType<typeof ProtocolDecisionEffect.decode>;
type DecodedConflictIssue = ReturnType<typeof ProtocolConflictIssue.decode>;

export type ProtocolCommandCase = NonNullable<DecodedEngineCommand["command"]>["$case"];
export type ProtocolQueryCase = NonNullable<DecodedEngineQuery["query"]>["$case"];
export type ProtocolMutationCase = NonNullable<DecodedEditMutation["mutation"]>["$case"];
export type ProtocolWriteResultCase = NonNullable<DecodedWriteResult["result"]>["$case"];
export type ProtocolQueryResultCase = NonNullable<DecodedQueryResult["result"]>["$case"];
export type ProtocolDecisionEffectCase = NonNullable<DecodedDecisionEffect["effect"]>["$case"];
export type ProtocolConflictIssueCase = NonNullable<DecodedConflictIssue["issue"]>["$case"];

const COMMAND_KIND_BY_CASE = {
  mutate: "mutate",
  resolveReview: "resolve-review",
  adjudicateResolution: "adjudicate-resolution",
  undo: "undo",
  redo: "redo",
  acknowledgeDeletion: "acknowledge-deletion",
  retireReplica: "retire-replica",
  hardDelete: "hard-delete",
} as const satisfies Readonly<Record<ProtocolCommandCase, EngineCommand["kind"]>>;

const QUERY_KIND_BY_CASE = {
  projection: "projection",
  review: "review",
  history: "history",
  invocation: "invocation",
  conflicts: "conflicts",
  supertagInstances: "supertag-instances",
  hardDeletePreview: "hard-delete-preview",
  backlinks: "backlinks",
  searchResults: "search-results",
  viewRows: "view-rows",
  outline: "outline",
  debugNode: "debug-node",
  trashEvidence: "trash-evidence",
} as const satisfies Readonly<Record<ProtocolQueryCase, EngineQuery["kind"]>>;

const MUTATION_KIND_BY_CASE = {
  nodeCreate: "node-create",
  referencePromote: "reference-promote",
  nodeDelete: "node-delete",
  nodeRestore: "node-restore",
  occurrenceCreate: "occurrence-create",
  occurrenceDelete: "occurrence-delete",
  occurrenceRestore: "occurrence-restore",
  occurrenceMove: "occurrence-move",
  declareIntrinsicNodeType: "intrinsic-node-type-declare",
  supertagApplicationCreate: "supertag-application-create",
  supertagRemove: "supertag-remove",
  supertagExtensionAdd: "supertag-extension-add",
  supertagExtensionRemove: "supertag-extension-remove",
  supertagTemplateNodeAdd: "supertag-template-node-add",
  supertagTemplateNodeRemove: "supertag-template-node-remove",
  templateNodeDetach: "template-node-detach",
  fieldMaterialize: "field-materialize",
  fieldValueDelete: "field-value-delete",
  materializedFieldDelete: "materialized-field-delete",
  textSplice: "text-splice",
  textMark: "text-mark",
  inlineReferenceCreate: "inline-reference-create",
  inlineReferenceDelete: "inline-reference-delete",
  inlineReferenceAliasAttach: "inline-reference-alias-attach",
  inlineReferenceAliasDetach: "inline-reference-alias-detach",
  inlineReferenceAliasCreate: "inline-reference-alias-create",
  searchExpressionCreate: "search-expression-create",
  searchExpressionUpdate: "search-expression-update",
  sharedDefaultViewDefinitionCreate: "shared-default-view-definition-create",
  sharedDefaultViewDefinitionRemove: "shared-default-view-definition-remove",
  sharedDefaultViewDefinitionModeSet: "shared-default-view-definition-mode-set",
  sharedDefaultViewDefinitionOptionsUpdate: "shared-default-view-definition-options-update",
  fieldDatatypeConfigure: "field-datatype-configure",
  fieldCardinalityConfigure: "field-cardinality-configure",
  fieldOptionalityConfigure: "field-optionality-configure",
  fieldDatatypeConfigurationCreate: "field-datatype-configuration-create",
  fieldCardinalityConfigurationCreate: "field-cardinality-configuration-create",
  fieldOptionalityConfigurationCreate: "field-optionality-configuration-create",
  fieldInitializationExpressionConfigurationCreate: "field-initialization-expression-configuration-create",
  debugNodeOpen: "debug-node-open",
  fieldValueCreate: "field-value-create",
  urlNodeCreate: "url-node-create",
  codeNodeConfigure: "code-node-configure",
  sharedDefaultViewDefinitionSortByNameCreate: "shared-default-view-definition-sort-by-name-create",
  supertagTemplateFieldCreate: "supertag-template-field-create",
  supertagTemplateFieldAddExisting: "supertag-template-field-add-existing",
  supertagTemplateFieldMakeDiscoverable: "supertag-template-field-make-discoverable",
  supertagTemplateFieldRemove: "supertag-template-field-remove",
  supertagOptionalFieldContributionAdd: "supertag-optional-field-contribution-add",
  supertagTemplateFieldVisibilitySet: "supertag-template-field-visibility-set",
  supertagTemplateFieldStaticDefaultSet: "supertag-template-field-static-default-set",
  fieldNumberValueSet: "field-number-value-set",
  fieldDateValueSet: "field-date-value-set",
  fieldCheckboxValueSet: "field-checkbox-value-set",
  fieldOptionsFromSupertagValueSet: "field-options-from-supertag-value-set",
  typedFieldValueClear: "typed-field-value-clear",
} as const satisfies Readonly<Record<ProtocolMutationCase, EditMutation["kind"]>>;

const WRITE_STATUS_BY_CASE = {
  published: "published",
  committedProjectionPending: "committed-projection-pending",
  rejected: "rejected",
  outcomeUnknown: "outcome-unknown",
} as const satisfies Readonly<Record<ProtocolWriteResultCase, WriteResult["status"]>>;

const DECISION_EFFECT_CASE_BY_KIND = {
  text: "text",
  structure: "structure",
  lifecycle: "lifecycle",
  owner: "owner",
  "intrinsic-node-type": "intrinsicNodeType",
  "supertag-relation": "supertagRelation",
  "field-materialization": "fieldMaterialization",
  "inline-reference": "inlineReference",
  "view-definition": "viewDefinition",
  "field-definition-configuration": "fieldDefinitionConfiguration",
} as const satisfies Readonly<Record<DecisionEffect["kind"], ProtocolDecisionEffectCase>>;

const CONFLICT_KIND_BY_CASE = {
  unsupportedDirectIntent: "unsupported-direct-intent",
  intrinsicNodeTypeConflict: "intrinsic-node-type-conflict",
  resolutionConflict: "resolution-conflict",
  placementConflict: "placement-conflict",
  supertagExtensionCycle: "supertag-extension-cycle",
} as const satisfies Readonly<Record<ProtocolConflictIssueCase, ConflictIssue["kind"]>>;

type AssertNever<Value extends never> = Value;
export type ProtocolCommandCoverage = AssertNever<
  Exclude<EngineCommand["kind"], (typeof COMMAND_KIND_BY_CASE)[ProtocolCommandCase]>
>;
export type ProtocolQueryCoverage = AssertNever<
  Exclude<EngineQuery["kind"], (typeof QUERY_KIND_BY_CASE)[ProtocolQueryCase]>
>;
export type ProtocolMutationCoverage = AssertNever<
  Exclude<EditMutation["kind"], (typeof MUTATION_KIND_BY_CASE)[ProtocolMutationCase]>
>;
export type ProtocolWriteResultCoverage = AssertNever<
  Exclude<WriteResult["status"], (typeof WRITE_STATUS_BY_CASE)[ProtocolWriteResultCase]>
>;
export type ProtocolQueryResultCoversQueries = AssertNever<
  Exclude<ProtocolQueryCase, Exclude<ProtocolQueryResultCase, "rejected">>
>;
export type ProtocolQueriesCoverQueryResults = AssertNever<
  Exclude<Exclude<ProtocolQueryResultCase, "rejected">, ProtocolQueryCase>
>;
export type ProtocolDecisionEffectCoverage = AssertNever<
  Exclude<ProtocolDecisionEffectCase, (typeof DECISION_EFFECT_CASE_BY_KIND)[DecisionEffect["kind"]]>
>;
export type ProtocolConflictIssueCoverage = AssertNever<
  Exclude<ConflictIssue["kind"], (typeof CONFLICT_KIND_BY_CASE)[ProtocolConflictIssueCase]>
>;

export const COMMAND_KINDS = Object.values(COMMAND_KIND_BY_CASE);
export const QUERY_KINDS = Object.values(QUERY_KIND_BY_CASE);
export const MUTATION_KINDS = Object.values(MUTATION_KIND_BY_CASE);
export const DECISION_EFFECT_KINDS = Object.keys(DECISION_EFFECT_CASE_BY_KIND) as readonly DecisionEffect["kind"][];

export function protocolCommandCase(kind: EngineCommand["kind"]): ProtocolCommandCase {
  return caseFor(kind, COMMAND_KIND_BY_CASE, "command");
}

export function commandKind(protocolCase: ProtocolCommandCase): EngineCommand["kind"] {
  return COMMAND_KIND_BY_CASE[protocolCase];
}

export function protocolQueryCase(kind: EngineQuery["kind"]): ProtocolQueryCase {
  return caseFor(kind, QUERY_KIND_BY_CASE, "query");
}

export function queryKind(protocolCase: ProtocolQueryCase): EngineQuery["kind"] {
  return QUERY_KIND_BY_CASE[protocolCase];
}

export function protocolMutationCase(kind: EditMutation["kind"]): ProtocolMutationCase {
  return caseFor(kind, MUTATION_KIND_BY_CASE, "mutation");
}

export function mutationKind(protocolCase: ProtocolMutationCase): EditMutation["kind"] {
  return MUTATION_KIND_BY_CASE[protocolCase];
}

export function protocolWriteResultCase(status: WriteResult["status"]): ProtocolWriteResultCase {
  return caseFor(status, WRITE_STATUS_BY_CASE, "write result");
}

export function writeResultStatus(protocolCase: ProtocolWriteResultCase): WriteResult["status"] {
  return WRITE_STATUS_BY_CASE[protocolCase];
}

export function protocolDecisionEffectCase(kind: DecisionEffect["kind"]): ProtocolDecisionEffectCase {
  return DECISION_EFFECT_CASE_BY_KIND[kind];
}

export function decisionEffectKind(protocolCase: ProtocolDecisionEffectCase): DecisionEffect["kind"] {
  const kind = Object.entries(DECISION_EFFECT_CASE_BY_KIND).find(([, candidate]) => candidate === protocolCase)?.[0];
  if (!kind) {
    throw new Error(`SDK has no Decision Effect kind for ${protocolCase}`);
  }
  return kind as DecisionEffect["kind"];
}

export function protocolConflictIssueCase(kind: ConflictIssue["kind"]): ProtocolConflictIssueCase {
  return caseFor(kind, CONFLICT_KIND_BY_CASE, "Conflict Issue");
}

export function conflictIssueKind(protocolCase: ProtocolConflictIssueCase): ConflictIssue["kind"] {
  return CONFLICT_KIND_BY_CASE[protocolCase];
}

function caseFor<Case extends string, Value extends string>(
  value: Value,
  valuesByCase: Readonly<Record<Case, Value>>,
  label: string,
): Case {
  for (const [protocolCase, candidate] of Object.entries(valuesByCase)) {
    if (candidate === value) {
      return protocolCase as Case;
    }
  }
  throw new Error(`Protocol has no ${label} case for ${value}`);
}
