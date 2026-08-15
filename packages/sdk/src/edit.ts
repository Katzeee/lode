import type {
  FieldMaterializeMutation as ProtocolFieldMaterializeMutation,
  FieldValueDeleteMutation as ProtocolFieldValueDeleteMutation,
  MaterializedFieldDeleteMutation as ProtocolMaterializedFieldDeleteMutation,
  NodeCreateMutation as ProtocolNodeCreateMutation,
  NodeDeleteMutation as ProtocolNodeDeleteMutation,
  NodeRestoreMutation as ProtocolNodeRestoreMutation,
  NodeTypeDeclareMutation as ProtocolNodeTypeDeclareMutation,
  OccurrenceCreateMutation as ProtocolOccurrenceCreateMutation,
  OccurrenceDeleteMutation as ProtocolOccurrenceDeleteMutation,
  OccurrenceMoveMutation as ProtocolOccurrenceMoveMutation,
  OccurrenceRestoreMutation as ProtocolOccurrenceRestoreMutation,
  ReferencePromoteMutation as ProtocolReferencePromoteMutation,
  SchemaApplyMutation as ProtocolSchemaApplyMutation,
  SchemaExtensionAddMutation as ProtocolSchemaExtensionAddMutation,
  SchemaExtensionRemoveMutation as ProtocolSchemaExtensionRemoveMutation,
  SchemaFieldAddMutation as ProtocolSchemaFieldAddMutation,
  SchemaFieldConfigureMutation as ProtocolSchemaFieldConfigureMutation,
  SchemaFieldRemoveMutation as ProtocolSchemaFieldRemoveMutation,
  SchemaRemoveMutation as ProtocolSchemaRemoveMutation,
  SchemaTemplateNodeAddMutation as ProtocolSchemaTemplateNodeAddMutation,
  SchemaTemplateNodeRemoveMutation as ProtocolSchemaTemplateNodeRemoveMutation,
  TemplateNodeDetachMutation as ProtocolTemplateNodeDetachMutation,
  TextMarkMutation as ProtocolTextMarkMutation,
  TextSpliceMutation as ProtocolTextSpliceMutation,
  ValueSetMutation as ProtocolValueSetMutation,
  ValueUnsetMutation as ProtocolValueUnsetMutation,
} from "@lode/protocol/dto/edit";
import type {
  FieldTemplateConfig,
  JsonValue,
  NodeSeed,
  NodeType,
  PreviousValue,
  ProtocolDto,
  SequenceAnchor,
  TextAtomId,
  ValueTarget,
} from "./model.js";
import type { ValueNamespace } from "./protocol-enums/model.js";

type WithKind<Value, Kind extends string> = Omit<ProtocolDto<Value>, "kind"> & Readonly<{ kind: Kind }>;

type NodeCreateMutation = Omit<WithKind<ProtocolNodeCreateMutation, "node-create">, "anchor" | "seed" | "nodeType"> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed; nodeType?: NodeType }>;
type SchemaFieldConfigureMutation = Omit<
  WithKind<ProtocolSchemaFieldConfigureMutation, "schema-field-configure">,
  "config"
> &
  Readonly<{ config: FieldTemplateConfig }>;
type TemplateNodeDetachMutation = Omit<
  WithKind<ProtocolTemplateNodeDetachMutation, "template-node-detach">,
  "anchor" | "sourceSchemaIds" | "sourceApplicationSchemaIds" | "sourceTemplateOccurrenceIds"
> &
  Readonly<{
    anchor: SequenceAnchor;
    sourceSchemaIds?: readonly string[];
    sourceApplicationSchemaIds?: readonly string[];
    sourceTemplateOccurrenceIds?: readonly string[];
  }>;
type TextSpliceMutation = Omit<
  WithKind<ProtocolTextSpliceMutation, "text-splice">,
  "anchor" | "deleteAtomIds" | "attributes"
> &
  Readonly<{
    anchor: SequenceAnchor;
    deleteAtomIds: readonly TextAtomId[];
    attributes?: Readonly<Record<string, JsonValue>>;
  }>;
type TextMarkMutation = Omit<WithKind<ProtocolTextMarkMutation, "text-mark">, "atomIds" | "value"> &
  Readonly<{ atomIds: readonly TextAtomId[]; value: PreviousValue }>;
type ValueSetMutation = Omit<WithKind<ProtocolValueSetMutation, "value-set">, "target" | "namespace" | "value"> &
  Readonly<{
    target: ValueTarget;
    namespace: ValueNamespace;
    value: JsonValue;
  }>;
type ValueUnsetMutation = Omit<WithKind<ProtocolValueUnsetMutation, "value-unset">, "target" | "namespace"> &
  Readonly<{ target: ValueTarget; namespace: ValueNamespace }>;

export type EditMutation =
  | NodeCreateMutation
  | WithKind<ProtocolReferencePromoteMutation, "reference-promote">
  | WithKind<ProtocolNodeDeleteMutation, "node-delete">
  | WithKind<ProtocolNodeRestoreMutation, "node-restore">
  | (Omit<WithKind<ProtocolOccurrenceCreateMutation, "occurrence-create">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolOccurrenceDeleteMutation, "occurrence-delete">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolOccurrenceRestoreMutation, "occurrence-restore">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolOccurrenceMoveMutation, "occurrence-move">, "anchor" | "previousAnchor"> &
      Readonly<{ anchor: SequenceAnchor; previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolNodeTypeDeclareMutation, "node-type-declare">, "nodeType"> &
      Readonly<{ nodeType: NodeType }>)
  | (Omit<WithKind<ProtocolSchemaApplyMutation, "schema-apply">, "anchor"> & Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSchemaRemoveMutation, "schema-remove">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSchemaFieldAddMutation, "schema-field-add">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSchemaFieldRemoveMutation, "schema-field-remove">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | SchemaFieldConfigureMutation
  | (Omit<WithKind<ProtocolSchemaExtensionAddMutation, "schema-extension-add">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSchemaExtensionRemoveMutation, "schema-extension-remove">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSchemaTemplateNodeAddMutation, "schema-template-node-add">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSchemaTemplateNodeRemoveMutation, "schema-template-node-remove">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | TemplateNodeDetachMutation
  | WithKind<ProtocolFieldMaterializeMutation, "field-materialize">
  | (Omit<WithKind<ProtocolFieldValueDeleteMutation, "field-value-delete">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolMaterializedFieldDeleteMutation, "materialized-field-delete">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | TextSpliceMutation
  | TextMarkMutation
  | ValueSetMutation
  | ValueUnsetMutation;
