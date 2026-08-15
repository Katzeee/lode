import { ContributionMutationKind as ProtocolContributionMutationKind } from "@lode/protocol/dto/fact";
import { defineProtocolEnum, type DomainEnum } from "./enum-codec.js";

export const contributionMutationKind = defineProtocolEnum<ProtocolContributionMutationKind>()(
  {
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_UNSPECIFIED]: null,
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_NODE_CREATE]: "node-create",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_NODE_DELETE]: "node-delete",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_NODE_RESTORE]: "node-restore",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_OCCURRENCE_CREATE]: "occurrence-create",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_OCCURRENCE_DELETE]: "occurrence-delete",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_OCCURRENCE_RESTORE]: "occurrence-restore",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_OCCURRENCE_MOVE]: "occurrence-move",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_NODE_OWNER_SET]: "node-owner-set",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_NODE_TYPE_DECLARE]: "node-type-declare",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SCHEMA_APPLY]: "schema-apply",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SCHEMA_REMOVE]: "schema-remove",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SCHEMA_FIELD_ADD]: "schema-field-add",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SCHEMA_FIELD_REMOVE]: "schema-field-remove",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SCHEMA_FIELD_CONFIGURE]: "schema-field-configure",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SCHEMA_EXTENSION_ADD]: "schema-extension-add",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SCHEMA_EXTENSION_REMOVE]: "schema-extension-remove",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SCHEMA_TEMPLATE_NODE_ADD]: "schema-template-node-add",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SCHEMA_TEMPLATE_NODE_REMOVE]:
      "schema-template-node-remove",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_TEMPLATE_NODE_DETACH]: "template-node-detach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_FIELD_MATERIALIZE]: "field-materialize",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_FIELD_VALUE_DELETE]: "field-value-delete",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_MATERIALIZED_FIELD_DELETE]:
      "materialized-field-delete",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_FIELD_INITIALIZE]: "field-initialize",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_TEXT_SPLICE]: "text-splice",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_TEXT_MARK]: "text-mark",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_VALUE_SET]: "value-set",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_VALUE_UNSET]: "value-unset",
    [ProtocolContributionMutationKind.UNRECOGNIZED]: null,
  },
  "Contribution mutation kind",
);
export type ContributionMutationKind = DomainEnum<typeof contributionMutationKind>;
