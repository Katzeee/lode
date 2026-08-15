import { EditMutationKind as ProtocolEditMutationKind } from "@lode/protocol/dto/edit";
import { defineProtocolEnum, type DomainEnum } from "./enum-codec.js";

export const editMutationKind = defineProtocolEnum<ProtocolEditMutationKind>()(
  {
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_UNSPECIFIED]: null,
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_NODE_CREATE]: "node-create",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_REFERENCE_PROMOTE]: "reference-promote",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_NODE_DELETE]: "node-delete",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_NODE_RESTORE]: "node-restore",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_OCCURRENCE_CREATE]: "occurrence-create",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_OCCURRENCE_DELETE]: "occurrence-delete",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_OCCURRENCE_RESTORE]: "occurrence-restore",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_OCCURRENCE_MOVE]: "occurrence-move",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_NODE_TYPE_DECLARE]: "node-type-declare",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_SCHEMA_APPLY]: "schema-apply",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_SCHEMA_REMOVE]: "schema-remove",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_SCHEMA_FIELD_ADD]: "schema-field-add",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_SCHEMA_FIELD_REMOVE]: "schema-field-remove",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_SCHEMA_FIELD_CONFIGURE]: "schema-field-configure",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_SCHEMA_EXTENSION_ADD]: "schema-extension-add",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_SCHEMA_EXTENSION_REMOVE]: "schema-extension-remove",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_SCHEMA_TEMPLATE_NODE_ADD]: "schema-template-node-add",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_SCHEMA_TEMPLATE_NODE_REMOVE]: "schema-template-node-remove",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_TEMPLATE_NODE_DETACH]: "template-node-detach",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_FIELD_MATERIALIZE]: "field-materialize",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_FIELD_VALUE_DELETE]: "field-value-delete",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_MATERIALIZED_FIELD_DELETE]: "materialized-field-delete",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_TEXT_SPLICE]: "text-splice",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_TEXT_MARK]: "text-mark",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_VALUE_SET]: "value-set",
    [ProtocolEditMutationKind.EDIT_MUTATION_KIND_VALUE_UNSET]: "value-unset",
    [ProtocolEditMutationKind.UNRECOGNIZED]: null,
  },
  "Edit mutation kind",
);
export type EditMutationKind = DomainEnum<typeof editMutationKind>;
