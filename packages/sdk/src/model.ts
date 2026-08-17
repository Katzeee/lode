import type {
  AuthorityReceipt as ProtocolAuthorityReceipt,
  NodeSeed as ProtocolNodeSeed,
  PreviousValue as ProtocolPreviousValue,
  ProjectionIdentity as ProtocolProjectionIdentity,
  ReceiptLineage as ProtocolReceiptLineage,
  SequenceAnchor as ProtocolSequenceAnchor,
} from "@lode/protocol/dto/model";
import type {
  AnchorAffinity,
  AnchorFallback,
  HistoryOperation,
  IntrinsicNodeType,
  ViewType,
  TemplateFieldVisibility,
  ViewSortDirection,
} from "./protocol-enums/model.js";
import type { ProjectionPerspective } from "./protocol-enums/projection.js";
import type { ResolutionDecision } from "./protocol-enums/review.js";
import type { EditIntent } from "./protocol-enums/engine.js";

export type WorkspaceId = string;
export type ReplicaId = string;
export type ActorId = string;
export type InvocationId = string;
export type HistoryChannelId = string;
export type { EditIntent, ResolutionDecision, ProjectionPerspective };

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;
export type FactFrontier = Readonly<Record<ReplicaId, number>>;
export type TextAtomId = `${string}#${number}`;
export type InlineReferenceId = string;

type IsAny<Value> = 0 extends 1 & Value ? true : false;
export type ProtocolDto<Value> =
  IsAny<Value> extends true
    ? JsonValue
    : Value extends readonly (infer Item)[]
      ? readonly ProtocolDto<Item>[]
      : Value extends object
        ? { readonly [Key in keyof Value]: ProtocolDto<Value[Key]> }
        : Value;

export type SequenceAnchor = Omit<ProtocolDto<ProtocolSequenceAnchor>, "affinity" | "fallback"> &
  Readonly<{ affinity: AnchorAffinity; fallback: AnchorFallback }>;
type PreviousValueCase = NonNullable<ProtocolPreviousValue["state"]>["$case"];
export type PreviousValue =
  | Readonly<{ kind: Extract<PreviousValueCase, "unset">; value?: never }>
  | Readonly<{ kind: Extract<PreviousValueCase, "set">; value: JsonValue }>;
export type { IntrinsicNodeType };
export type { ViewType };
export type { TemplateFieldVisibility };
export type { ViewSortDirection };

export type NodeSeed = ProtocolDto<ProtocolNodeSeed>;

export type FieldInitializationExpression = Readonly<{
  kind: "find-field-values";
  expressionNodeId: string;
  expressionOccurrenceId: string;
  sourceFieldDefinitionId: string;
  sourceFieldDefinitionOccurrenceId: string;
  contextNodeId: string;
  contextOccurrenceId: string;
}>;
export type SearchFieldValue =
  | Readonly<{ kind: "node"; nodeId: string }>
  | Readonly<{ kind: "text"; value: string }>
  | Readonly<{ kind: "number"; value: number }>
  | Readonly<{ kind: "checkbox"; value: boolean }>
  | Readonly<{ kind: "date"; value: string }>;
export type SearchScopeTarget =
  Readonly<{ kind: "node"; nodeId: string }> | Readonly<{ kind: "parent" }> | Readonly<{ kind: "grandparent" }>;
export type SearchExpressionSpec =
  | Readonly<{ expressionNodeId: string; kind: "and" | "or"; operands: readonly SearchExpressionSpec[] }>
  | Readonly<{ expressionNodeId: string; kind: "not"; operand: SearchExpressionSpec }>
  | Readonly<{ expressionNodeId: string; kind: "supertag"; supertagId: string }>
  | Readonly<{ expressionNodeId: string; kind: "text"; text: string }>
  | Readonly<{
      expressionNodeId: string;
      kind: "field-defined";
      fieldDefinitionId: string;
      defined: boolean;
    }>
  | Readonly<{
      expressionNodeId: string;
      kind: "field-value";
      fieldDefinitionId: string;
      value: SearchFieldValue;
    }>
  | Readonly<{
      expressionNodeId: string;
      kind: "date-compare";
      fieldDefinitionId: string;
      operator: "lt" | "gt";
      date: string;
    }>
  | Readonly<{
      expressionNodeId: string;
      kind: "descendant-of" | "child-of";
      target: SearchScopeTarget;
    }>
  | Readonly<{ expressionNodeId: string; kind: "links-to"; targetNodeId: string }>;
export type ViewColumnSpec = Readonly<{ columnNodeId: string; fieldDefinitionId: string }>;
export type ViewFilterSpec = Readonly<{ filterNodeId: string; expression: SearchExpressionSpec }>;
export type ViewSortSpec = Readonly<{
  sortNodeId: string;
  fieldDefinitionId: string;
  direction: ViewSortDirection;
}>;
export type ViewGroupSpec = Readonly<{ groupNodeId: string; fieldDefinitionId: string }>;
export type ViewOptionsSpec = Readonly<{
  columns: readonly ViewColumnSpec[];
  filter: ViewFilterSpec | null;
  sort: ViewSortSpec | null;
  group: ViewGroupSpec | null;
}>;
export type ReceiptLineage = Omit<ProtocolDto<ProtocolReceiptLineage>, "operation"> &
  Readonly<{ operation: HistoryOperation }>;
export type AuthorityReceipt = Omit<ProtocolDto<ProtocolAuthorityReceipt>, "lineage"> &
  Readonly<{ lineage: ReceiptLineage | null }>;
export type ProjectionIdentity = ProtocolDto<ProtocolProjectionIdentity>;

type AssertNever<Value extends never> = Value;
export type PreviousValueCoverage = AssertNever<Exclude<PreviousValueCase, PreviousValue["kind"]>>;
