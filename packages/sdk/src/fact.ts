import type {
  FieldMaterializeMutation as ProtocolFieldMaterializeMutation,
  FieldValueDeleteMutation as ProtocolFieldValueDeleteMutation,
  MaterializedFieldDeleteMutation as ProtocolMaterializedFieldDeleteMutation,
  NodeDeleteMutation as ProtocolNodeDeleteMutation,
  NodeRestoreMutation as ProtocolNodeRestoreMutation,
  NodeTypeDeclareMutation as ProtocolNodeTypeDeclareMutation,
  OccurrenceCreateMutation as ProtocolOccurrenceCreateMutation,
  OccurrenceDeleteMutation as ProtocolOccurrenceDeleteMutation,
  OccurrenceMoveMutation as ProtocolOccurrenceMoveMutation,
  OccurrenceRestoreMutation as ProtocolOccurrenceRestoreMutation,
  SchemaApplyMutation as ProtocolSchemaApplyMutation,
  SchemaExtensionAddMutation as ProtocolSchemaExtensionAddMutation,
  SchemaExtensionRemoveMutation as ProtocolSchemaExtensionRemoveMutation,
  SchemaFieldAddMutation as ProtocolSchemaFieldAddMutation,
  SchemaFieldRemoveMutation as ProtocolSchemaFieldRemoveMutation,
  SchemaRemoveMutation as ProtocolSchemaRemoveMutation,
  SchemaTemplateNodeAddMutation as ProtocolSchemaTemplateNodeAddMutation,
  SchemaTemplateNodeRemoveMutation as ProtocolSchemaTemplateNodeRemoveMutation,
  TemplateNodeDetachMutation as ProtocolTemplateNodeDetachMutation,
} from "@lode/protocol/dto/edit";
import type {
  ContributionNodeCreateMutation as ProtocolContributionNodeCreateMutation,
  ContributionSchemaFieldConfigureMutation as ProtocolContributionSchemaFieldConfigureMutation,
  ContributionTextMarkMutation as ProtocolContributionTextMarkMutation,
  ContributionTextSpliceMutation as ProtocolContributionTextSpliceMutation,
  ContributionValueSetMutation as ProtocolContributionValueSetMutation,
  ContributionValueUnsetMutation as ProtocolContributionValueUnsetMutation,
  FieldInitializeMutation as ProtocolFieldInitializeMutation,
  InitializedReferenceFieldValue as ProtocolInitializedReferenceFieldValue,
  InitializedTextFieldValue as ProtocolInitializedTextFieldValue,
  NodeOwnerSetMutation as ProtocolNodeOwnerSetMutation,
} from "@lode/protocol/dto/fact";
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
import type { FieldInitializationSource, ValueNamespace } from "./protocol-enums/model.js";

type WithKind<Value, Kind extends string> = Omit<ProtocolDto<Value>, "kind"> & Readonly<{ kind: Kind }>;

type NodeCreateMutation = Omit<WithKind<ProtocolContributionNodeCreateMutation, "node-create">, "seed"> &
  Readonly<{ seed?: NodeSeed }>;
type NodeOwnerSetMutation = Omit<WithKind<ProtocolNodeOwnerSetMutation, "node-owner-set">, "previousOwnerNodeId"> &
  Readonly<{ previousOwnerNodeId?: string }>;
type SchemaFieldConfigureMutation = Omit<
  WithKind<ProtocolContributionSchemaFieldConfigureMutation, "schema-field-configure">,
  "config" | "previousConfig" | "observedConfigFactIds"
> &
  Readonly<{
    config: FieldTemplateConfig;
    previousConfig?: FieldTemplateConfig | null;
    observedConfigFactIds?: readonly string[];
  }>;

export type InitializedFieldValue =
  WithKind<ProtocolInitializedTextFieldValue, "text"> | WithKind<ProtocolInitializedReferenceFieldValue, "reference">;

type FieldInitializeMutation = Omit<
  WithKind<ProtocolFieldInitializeMutation, "field-initialize">,
  "source" | "values" | "observedInitializationFactIds"
> &
  Readonly<{
    source: FieldInitializationSource;
    values: readonly InitializedFieldValue[];
    observedInitializationFactIds?: readonly string[];
  }>;
type TextSpliceMutation = Omit<
  WithKind<ProtocolContributionTextSpliceMutation, "text-splice">,
  "deleteAtomIds" | "deletedAtoms" | "anchor" | "attributes"
> &
  Readonly<{
    deleteAtomIds: readonly TextAtomId[];
    deletedAtoms?: readonly Readonly<{
      id: TextAtomId;
      value: string;
      attributes: Readonly<Record<string, JsonValue>>;
    }>[];
    anchor: SequenceAnchor;
    attributes?: Readonly<Record<string, JsonValue>>;
  }>;
type TextMarkMutation = Omit<
  WithKind<ProtocolContributionTextMarkMutation, "text-mark">,
  "atomIds" | "value" | "previous"
> &
  Readonly<{ atomIds: readonly TextAtomId[]; value: PreviousValue; previous?: PreviousValue }>;
type ValueSetMutation = Omit<
  WithKind<ProtocolContributionValueSetMutation, "value-set">,
  "target" | "namespace" | "value" | "previous"
> &
  Readonly<{
    target: ValueTarget;
    namespace: ValueNamespace;
    value: JsonValue;
    previous?: PreviousValue;
  }>;
type ValueUnsetMutation = Omit<
  WithKind<ProtocolContributionValueUnsetMutation, "value-unset">,
  "target" | "namespace" | "previous"
> &
  Readonly<{ target: ValueTarget; namespace: ValueNamespace; previous?: PreviousValue }>;
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

export type ContributionMutation =
  | NodeCreateMutation
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
  | NodeOwnerSetMutation
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
  | FieldInitializeMutation
  | TextSpliceMutation
  | TextMarkMutation
  | ValueSetMutation
  | ValueUnsetMutation;
