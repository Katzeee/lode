import type {
  AuthorityReceipt as ProtocolAuthorityReceipt,
  FieldInitializer as ProtocolFieldInitializer,
  FieldTemplateConfig as ProtocolFieldTemplateConfig,
  FieldValueSeed as ProtocolFieldValueSeed,
  NodeSeed as ProtocolNodeSeed,
  PreviousValue as ProtocolPreviousValue,
  ProjectionIdentity as ProtocolProjectionIdentity,
  ReceiptLineage as ProtocolReceiptLineage,
  SequenceAnchor as ProtocolSequenceAnchor,
  ValueTarget as ProtocolValueTarget,
} from "@lode/protocol/dto/model";
import type {
  AnchorAffinity,
  AnchorFallback,
  FieldVisibility,
  HistoryOperation,
  NodeType,
} from "./protocol-enums/model.js";
import type { ViewMode } from "./protocol-enums/projection.js";
import type { ResolutionDecision } from "./protocol-enums/review.js";
import type { EditIntent } from "./protocol-enums/engine.js";

export type WorkspaceId = string;
export type ReplicaId = string;
export type ActorId = string;
export type InvocationId = string;
export type HistoryChannelId = string;
export type { EditIntent, ResolutionDecision, ViewMode };

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;
export type FactFrontier = Readonly<Record<ReplicaId, number>>;
export type TextAtomId = `${string}#${number}`;

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
type ValueTargetCase = NonNullable<ProtocolValueTarget["target"]>["$case"];
export type ValueTarget = Readonly<{ kind: ValueTargetCase; id: string }>;
export type { NodeType };

export type NodeSeed = ProtocolDto<ProtocolNodeSeed>;

export type { FieldVisibility };
type FieldValueSeedCase = NonNullable<ProtocolFieldValueSeed["seed"]>["$case"];
export type FieldValueSeed =
  | Readonly<{ kind: Extract<FieldValueSeedCase, "text">; value: string; nodeId?: never }>
  | Readonly<{ kind: Extract<FieldValueSeedCase, "reference">; nodeId: string; value?: never }>;
type FieldInitializerCase = NonNullable<ProtocolFieldInitializer["initializer"]>["$case"];
type ErgonomicFieldInitializerKind<Kind extends FieldInitializerCase> = Kind extends "applicationNodeText"
  ? "application-node-text"
  : Kind;
type FieldInitializerKind = ErgonomicFieldInitializerKind<FieldInitializerCase>;
export type FieldInitializer =
  | Readonly<{ kind: Extract<FieldInitializerKind, "literal">; values: readonly FieldValueSeed[] }>
  | Readonly<{ kind: Extract<FieldInitializerKind, "application-node-text">; values?: never }>;
type FieldTemplateConfigBase = Omit<
  ProtocolDto<ProtocolFieldTemplateConfig>,
  "visibility" | "staticDefault" | "initializer"
>;
export type FieldTemplateConfig = FieldTemplateConfigBase &
  Readonly<{
    visibility: FieldVisibility;
    staticDefault: readonly FieldValueSeed[] | null;
    initializer: FieldInitializer | null;
  }>;

export type ReceiptLineage = Omit<ProtocolDto<ProtocolReceiptLineage>, "operation"> &
  Readonly<{ operation: HistoryOperation }>;
export type AuthorityReceipt = Omit<ProtocolDto<ProtocolAuthorityReceipt>, "lineage"> &
  Readonly<{ lineage: ReceiptLineage | null }>;
export type ProjectionIdentity = ProtocolDto<ProtocolProjectionIdentity>;

type AssertNever<Value extends never> = Value;
export type PreviousValueCoverage = AssertNever<Exclude<PreviousValueCase, PreviousValue["kind"]>>;
export type ValueTargetCoverage = AssertNever<Exclude<ValueTargetCase, ValueTarget["kind"]>>;
export type FieldValueSeedCoverage = AssertNever<Exclude<FieldValueSeedCase, FieldValueSeed["kind"]>>;
export type FieldInitializerCoverage = AssertNever<Exclude<FieldInitializerKind, FieldInitializer["kind"]>>;
