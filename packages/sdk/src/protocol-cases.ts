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
  nodeTypeDeclare: "node-type-declare",
  supertagApply: "supertag-apply",
  supertagRemove: "supertag-remove",
  supertagFieldAdd: "supertag-field-add",
  supertagFieldRemove: "supertag-field-remove",
  supertagFieldConfigure: "supertag-field-configure",
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
  searchSupertagClauseCreate: "search-supertag-clause-create",
  searchFieldClauseCreate: "search-field-clause-create",
  sharedDefaultViewDefinitionCreate: "shared-default-view-definition-create",
  sharedDefaultViewDefinitionModeSet: "shared-default-view-definition-mode-set",
  fieldDatatypeConfigure: "field-datatype-configure",
  fieldCardinalityConfigure: "field-cardinality-configure",
  fieldInitializationExpressionConfigure: "field-initialization-expression-configure",
  fieldDatatypeConfigurationCreate: "field-datatype-configuration-create",
  fieldCardinalityConfigurationCreate: "field-cardinality-configuration-create",
  fieldInitializationExpressionConfigurationCreate: "field-initialization-expression-configuration-create",
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
  "node-type": "nodeType",
  "supertag-relation": "supertagRelation",
  "field-configuration": "fieldConfiguration",
  "field-materialization": "fieldMaterialization",
  "inline-reference": "inlineReference",
  "view-definition": "viewDefinition",
  "field-definition-configuration": "fieldDefinitionConfiguration",
} as const satisfies Readonly<Record<DecisionEffect["kind"], ProtocolDecisionEffectCase>>;

const CONFLICT_KIND_BY_CASE = {
  unsupportedDirectIntent: "unsupported-direct-intent",
  nodeTypeConflict: "node-type-conflict",
  resolutionConflict: "resolution-conflict",
  placementConflict: "placement-conflict",
  supertagExtensionCycle: "supertag-extension-cycle",
  fieldConfigConflict: "field-config-conflict",
  fieldInitializationConflict: "field-initialization-conflict",
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
