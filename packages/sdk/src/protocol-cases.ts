import type { EditAction as ProtocolEditAction } from "@lode/protocol/dto/edit";
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
import type { EditAction } from "./edit.js";
import type { EngineCommand, EngineQuery, WriteResult } from "./contract.js";
import type { ConflictIssue, DecisionEffect } from "./review.js";

type DecodedEngineCommand = ReturnType<typeof ProtocolEngineCommand.decode>;
type DecodedEngineQuery = ReturnType<typeof ProtocolEngineQuery.decode>;
type DecodedQueryResult = ReturnType<typeof ProtocolQueryResult.decode>;
type DecodedEditAction = ReturnType<typeof ProtocolEditAction.decode>;
type DecodedWriteResult = ReturnType<typeof ProtocolWriteResult.decode>;
type DecodedDecisionEffect = ReturnType<typeof ProtocolDecisionEffect.decode>;
type DecodedConflictIssue = ReturnType<typeof ProtocolConflictIssue.decode>;

export type ProtocolCommandCase = NonNullable<DecodedEngineCommand["command"]>["$case"];
export type ProtocolQueryCase = NonNullable<DecodedEngineQuery["query"]>["$case"];
export type ProtocolActionCase = NonNullable<DecodedEditAction["action"]>["$case"];
export type ProtocolWriteResultCase = NonNullable<DecodedWriteResult["result"]>["$case"];
export type ProtocolQueryResultCase = NonNullable<DecodedQueryResult["result"]>["$case"];
export type ProtocolDecisionEffectCase = NonNullable<DecodedDecisionEffect["effect"]>["$case"];
export type ProtocolConflictIssueCase = NonNullable<DecodedConflictIssue["issue"]>["$case"];

const COMMAND_KIND_BY_CASE = {
  edit: "edit",
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

const ACTION_KIND_BY_CASE = {
  nodeCreate: "node-create",
  referencePromote: "reference-promote",
  nodeDelete: "node-delete",
  nodeRestore: "node-restore",
  occurrenceCreate: "occurrence-create",
  occurrenceDelete: "occurrence-delete",
  occurrenceRestore: "occurrence-restore",
  occurrenceMove: "occurrence-move",
  supertagApplicationCreate: "supertag-application-create",
  supertagRemove: "supertag-remove",
  supertagExtensionAdd: "supertag-extension-add",
  supertagExtensionRemove: "supertag-extension-remove",
  templateMemberAdd: "template-member-add",
  templateMemberRemove: "template-member-remove",
  templateNodeDetach: "template-node-detach",
  fieldMaterialize: "field-materialize",
  fieldValueRemove: "field-value-remove",
  materializedFieldClear: "materialized-field-clear",
  richTextSplice: "rich-text-splice",
  richTextMark: "rich-text-mark",
  inlineReferenceCreate: "inline-reference-create",
  inlineReferenceRemove: "inline-reference-remove",
  inlineAliasAttach: "inline-alias-attach",
  inlineAliasDetach: "inline-alias-detach",
  inlineReferenceAliasCreate: "inline-reference-alias-create",
  searchExpressionCreate: "search-expression-create",
  searchExpressionAdd: "search-expression-add",
  searchExpressionConfigure: "search-expression-configure",
  searchExpressionMove: "search-expression-move",
  searchExpressionRemove: "search-expression-remove",
  sharedDefaultViewCreate: "shared-default-view-create",
  sharedDefaultViewRemove: "shared-default-view-remove",
  viewModeSet: "view-mode-set",
  viewColumnAdd: "view-column-add",
  viewColumnRemove: "view-column-remove",
  viewColumnMove: "view-column-move",
  viewSortAdd: "view-sort-add",
  viewSortConfigure: "view-sort-configure",
  viewSortRemove: "view-sort-remove",
  viewSortByNodeName: "view-sort-by-node-name",
  viewGroupAdd: "view-group-add",
  viewGroupRemove: "view-group-remove",
  viewFilterCreate: "view-filter-create",
  viewFilterRemove: "view-filter-remove",
  viewFilterExpressionAdd: "view-filter-expression-add",
  viewFilterExpressionConfigure: "view-filter-expression-configure",
  viewFilterExpressionMove: "view-filter-expression-move",
  viewFilterExpressionRemove: "view-filter-expression-remove",
  fieldDatatypeConfigure: "field-datatype-configure",
  fieldCardinalityConfigure: "field-cardinality-configure",
  fieldOptionalityConfigure: "field-optionality-configure",
  fieldInitializationExpressionConfigure: "field-initialization-expression-configure",
  fieldValueCreate: "field-value-create",
  urlNodeCreate: "url-node-create",
  codeNodeConfigure: "code-node-configure",
  supertagTemplateFieldCreate: "supertag-template-field-create",
  supertagTemplateFieldAddExisting: "supertag-template-field-add-existing",
  supertagTemplateFieldMakeDiscoverable: "supertag-template-field-make-discoverable",
  supertagTemplateFieldRemove: "supertag-template-field-remove",
  supertagOptionalFieldContributionAdd: "supertag-optional-field-contribution-add",
  supertagOptionalFieldContributionRemove: "supertag-optional-field-contribution-remove",
  supertagTemplateFieldVisibilitySet: "supertag-template-field-visibility-set",
  supertagTemplateFieldStaticDefaultSet: "supertag-template-field-static-default-set",
  fieldNumberValueSet: "field-number-value-set",
  fieldDateValueSet: "field-date-value-set",
  fieldCheckboxValueSet: "field-checkbox-value-set",
  fieldOptionsFromSupertagValueSet: "field-options-from-supertag-value-set",
  typedFieldValueClear: "typed-field-value-clear",
} as const satisfies Readonly<Record<ProtocolActionCase, EditAction["kind"]>>;

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
  "search-expression": "searchExpression",
  "view-definition": "viewDefinition",
  "field-definition-configuration": "fieldDefinitionConfiguration",
} as const satisfies Readonly<Record<DecisionEffect["kind"], ProtocolDecisionEffectCase>>;

const CONFLICT_KIND_BY_CASE = {
  unsupportedDirectIntent: "unsupported-direct-intent",
  intrinsicNodeTypeConflict: "intrinsic-node-type-conflict",
  resolutionConflict: "resolution-conflict",
  placementConflict: "placement-conflict",
  originalConflict: "original-conflict",
  supertagExtensionCycle: "supertag-extension-cycle",
} as const satisfies Readonly<Record<ProtocolConflictIssueCase, ConflictIssue["kind"]>>;

type AssertNever<Value extends never> = Value;
export type ProtocolCommandCoverage = AssertNever<
  Exclude<EngineCommand["kind"], (typeof COMMAND_KIND_BY_CASE)[ProtocolCommandCase]>
>;
export type ProtocolQueryCoverage = AssertNever<
  Exclude<EngineQuery["kind"], (typeof QUERY_KIND_BY_CASE)[ProtocolQueryCase]>
>;
export type ProtocolActionCoverage = AssertNever<
  Exclude<EditAction["kind"], (typeof ACTION_KIND_BY_CASE)[ProtocolActionCase]>
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
export const ACTION_KINDS = Object.values(ACTION_KIND_BY_CASE);
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

export function protocolActionCase(kind: EditAction["kind"]): ProtocolActionCase {
  return caseFor(kind, ACTION_KIND_BY_CASE, "action");
}

export function actionKind(protocolCase: ProtocolActionCase): EditAction["kind"] {
  return ACTION_KIND_BY_CASE[protocolCase];
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
