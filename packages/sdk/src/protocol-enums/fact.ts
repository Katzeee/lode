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
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_DECLARE_INTRINSIC_NODE_TYPE]:
      "intrinsic-node-type-declare",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SUPERTAG_APPLY]: "supertag-apply",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SUPERTAG_REMOVE]: "supertag-remove",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SUPERTAG_EXTENSION_ADD]: "supertag-extension-add",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SUPERTAG_EXTENSION_REMOVE]:
      "supertag-extension-remove",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SUPERTAG_TEMPLATE_NODE_ADD]:
      "supertag-template-node-add",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SUPERTAG_TEMPLATE_NODE_REMOVE]:
      "supertag-template-node-remove",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_TEMPLATE_NODE_DETACH]: "template-node-detach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_FIELD_MATERIALIZE]: "field-materialize",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_FIELD_VALUE_DELETE]: "field-value-delete",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_MATERIALIZED_FIELD_DELETE]:
      "materialized-field-delete",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_TEXT_SPLICE]: "text-splice",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_TEXT_MARK]: "text-mark",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_METANODE_ATTACH]: "metanode-attach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_INLINE_REFERENCE_CREATE]: "inline-reference-create",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_INLINE_REFERENCE_DELETE]: "inline-reference-delete",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_INLINE_REFERENCE_ALIAS_ATTACH]:
      "inline-reference-alias-attach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_INLINE_REFERENCE_ALIAS_DETACH]:
      "inline-reference-alias-detach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SEARCH_EXPRESSION_ATTACH]: "search-expression-attach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SEARCH_EXPRESSION_DETACH]: "search-expression-detach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SHARED_DEFAULT_VIEW_DEFINITION_ATTACH]:
      "shared-default-view-definition-attach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SHARED_DEFAULT_VIEW_DEFINITION_DETACH]:
      "shared-default-view-definition-detach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SHARED_DEFAULT_VIEW_DEFINITION_MODE_SET]:
      "shared-default-view-definition-mode-set",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SHARED_DEFAULT_VIEW_DEFINITION_SORT_BY_NAME_SET]:
      "shared-default-view-definition-sort-by-name-set",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SHARED_DEFAULT_VIEW_DEFINITION_OPTIONS_SET]:
      "shared-default-view-definition-options-set",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_FIELD_DATATYPE_CONFIGURE]: "field-datatype-configure",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_FIELD_CARDINALITY_CONFIGURE]:
      "field-cardinality-configure",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_FIELD_OPTIONALITY_CONFIGURE]:
      "field-optionality-configure",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_FIELD_INITIALIZATION_EXPRESSION_CONFIGURE]:
      "field-initialization-expression-configure",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SUPERTAG_TEMPLATE_FIELD_ATTACH]:
      "supertag-template-field-attach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SUPERTAG_TEMPLATE_FIELD_EXISTING_ATTACH]:
      "supertag-template-field-existing-attach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SUPERTAG_TEMPLATE_FIELD_DETACH]:
      "supertag-template-field-detach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SUPERTAG_TEMPLATE_FIELD_DISCOVERABILITY_SET]:
      "supertag-template-field-discoverability-set",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SUPERTAG_OPTIONAL_FIELD_CONTRIBUTION_ATTACH]:
      "supertag-optional-field-contribution-attach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SUPERTAG_OPTIONAL_FIELD_CONTRIBUTION_DETACH]:
      "supertag-optional-field-contribution-detach",
    [ProtocolContributionMutationKind.CONTRIBUTION_MUTATION_KIND_SUPERTAG_TEMPLATE_FIELD_VISIBILITY_CONFIGURE]:
      "supertag-template-field-visibility-configure",
    [ProtocolContributionMutationKind.UNRECOGNIZED]: null,
  },
  "Contribution mutation kind",
);
export type ContributionMutationKind = DomainEnum<typeof contributionMutationKind>;
