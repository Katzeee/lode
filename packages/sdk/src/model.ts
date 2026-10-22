import type {
  AuthorityReceipt as ProtocolAuthorityReceipt,
  NodeSeed as ProtocolNodeSeed,
  PreviousValue as ProtocolPreviousValue,
  ProjectionIdentity as ProtocolProjectionIdentity,
  ReceiptLineage as ProtocolReceiptLineage,
  SequenceAnchor as ProtocolSequenceAnchor,
} from "@lode/protocol/proto";
import type { FactActionId, FactId } from "./fact-identities.js";
import type {
  AnchorAffinity,
  AnchorFallback,
  HistoryOperation,
  IntrinsicNodeType,
  ViewType,
  TemplateFieldVisibility,
} from "./protocol-enums/model.js";
import { viewSortDirection, type ViewSortDirection } from "./protocol-enums/model.js";
import { projectionPerspective, type ProjectionPerspective } from "./protocol-enums/projection.js";
import { resolutionDecision, type ResolutionDecision } from "./protocol-enums/review.js";
import { editIntent, type EditIntent } from "./protocol-enums/engine.js";
import type { ProtocolDto } from "./protocol-dto.js";

export type { EditIntent, ResolutionDecision, ProjectionPerspective };
export const EDIT_INTENTS: readonly EditIntent[] = editIntent.values;
export const PROJECTION_PERSPECTIVES: readonly ProjectionPerspective[] = projectionPerspective.values;
export const RESOLUTION_DECISIONS: readonly ResolutionDecision[] = resolutionDecision.values;
export const VIEW_SORT_DIRECTIONS: readonly ViewSortDirection[] = viewSortDirection.values;

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;
export type TextAtomId = `${FactActionId}#${number}`;

export type SequenceAnchor = Omit<ProtocolDto<ProtocolSequenceAnchor>, "affinity" | "fallback"> &
  Readonly<{ affinity: AnchorAffinity; fallback: AnchorFallback }>;
export const START_SEQUENCE_ANCHOR: SequenceAnchor = Object.freeze({
  after: null,
  before: null,
  affinity: "after",
  fallback: "start",
});
export const END_SEQUENCE_ANCHOR: SequenceAnchor = Object.freeze({
  after: null,
  before: null,
  affinity: "after",
  fallback: "end",
});
type PreviousValueCase = Exclude<ProtocolPreviousValue["state"]["case"], undefined>;
type PreviousValueByCase = Readonly<{
  unset: Readonly<{ kind: "unset"; value?: never }>;
  set: Readonly<{ kind: "set"; value: JsonValue }>;
}>;
type PreviousValueCasesAreComplete = [PreviousValueCase] extends [keyof PreviousValueByCase]
  ? [keyof PreviousValueByCase] extends [PreviousValueCase]
    ? true
    : false
  : false;
export type PreviousValue = PreviousValueCasesAreComplete extends true ? PreviousValueByCase[PreviousValueCase] : never;
export type { IntrinsicNodeType };
export type { ViewType };
export type { TemplateFieldVisibility };
export type { ViewSortDirection };

export type NodeSeed = ProtocolDto<ProtocolNodeSeed>;

export type FieldInitializationExpression = Readonly<{
  kind: "find-field-values";
  sourceFieldDefinitionId: string;
}>;
export type SearchFieldValue =
  | Readonly<{ kind: "node"; nodeId: string }>
  | Readonly<{ kind: "text"; value: string }>
  | Readonly<{ kind: "number"; value: number }>
  | Readonly<{ kind: "checkbox"; value: boolean }>
  | Readonly<{ kind: "date"; value: string }>;
export type SearchScopeTarget =
  Readonly<{ kind: "node"; nodeId: string }> | Readonly<{ kind: "parent" }> | Readonly<{ kind: "grandparent" }>;
export type SearchExpressionSpec = Readonly<{ expressionId: FactActionId; expressionNodeId: string }> &
  (
    | Readonly<{ kind: "and" | "or"; operands: readonly SearchExpressionSpec[] }>
    | Readonly<{ kind: "not"; operand: SearchExpressionSpec }>
    | Readonly<{ kind: "supertag"; supertagId: string }>
    | Readonly<{ kind: "text"; text: string }>
    | Readonly<{ kind: "field-defined"; fieldDefinitionId: string; defined: boolean }>
    | Readonly<{ kind: "field-value"; fieldDefinitionId: string; value: SearchFieldValue }>
    | Readonly<{
        kind: "date-compare";
        fieldDefinitionId: string;
        operator: "lt" | "gt";
        date: string;
      }>
    | Readonly<{ kind: "descendant-of" | "child-of"; target: SearchScopeTarget }>
    | Readonly<{ kind: "links-to"; targetNodeId: string }>
  );

export type SearchClause =
  | Readonly<{ kind: "and" | "or" | "not" }>
  | Readonly<{ kind: "supertag"; supertagId: string }>
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "field-defined"; fieldDefinitionId: string; defined: boolean }>
  | Readonly<{ kind: "field-value"; fieldDefinitionId: string; value: SearchFieldValue }>
  | Readonly<{ kind: "date-compare"; fieldDefinitionId: string; operator: "lt" | "gt"; date: string }>
  | Readonly<{ kind: "descendant-of" | "child-of"; target: SearchScopeTarget }>
  | Readonly<{ kind: "links-to"; targetNodeId: string }>;

export type SearchExpressionDraft =
  | Readonly<{ kind: "and" | "or"; operands: readonly SearchExpressionDraft[] }>
  | Readonly<{ kind: "not"; operand: SearchExpressionDraft }>
  | Exclude<SearchClause, { kind: "and" | "or" | "not" }>;
export type ViewColumnSpec = Readonly<{ columnId: FactActionId; columnNodeId: string; fieldDefinitionId: string }>;
export type ViewFilterSpec = Readonly<{
  filterId: FactActionId;
  filterNodeId: string;
  expression: SearchExpressionSpec;
}>;
export type ViewSortSpec = Readonly<{
  sortId: FactActionId;
  sortNodeId: string;
  fieldDefinitionId: string;
  direction: ViewSortDirection;
}>;
export type ViewGroupSpec = Readonly<{ groupId: FactActionId; groupNodeId: string; fieldDefinitionId: string }>;
export type ViewOptionsSpec = Readonly<{
  columns: readonly ViewColumnSpec[];
  filter: ViewFilterSpec | null;
  sort: ViewSortSpec | null;
  group: ViewGroupSpec | null;
}>;
export type ReceiptLineage = Omit<ProtocolDto<ProtocolReceiptLineage>, "operation"> &
  Readonly<{ operation: HistoryOperation }>;
export type AuthorityReceipt = Omit<ProtocolDto<ProtocolAuthorityReceipt>, "factIds" | "lineage"> &
  Readonly<{ factIds: readonly FactId[]; lineage: ReceiptLineage | null }>;
export type ProjectionIdentity = ProtocolDto<ProtocolProjectionIdentity>;
