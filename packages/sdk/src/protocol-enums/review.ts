import {
  DiffSpaceKind as ProtocolDiffSpaceKind,
  PlacementEndpoint as ProtocolPlacementEndpoint,
  RecoveryAction as ProtocolRecoveryAction,
  ResolutionDecision as ProtocolResolutionDecision,
  SupertagRelationKind as ProtocolSupertagRelationKind,
} from "@lode/protocol/dto/review";
import { defineProtocolEnum, type DomainEnum } from "./enum-codec.js";

export const resolutionDecision = defineProtocolEnum<ProtocolResolutionDecision>()(
  {
    [ProtocolResolutionDecision.RESOLUTION_DECISION_UNSPECIFIED]: null,
    [ProtocolResolutionDecision.RESOLUTION_DECISION_ACCEPT]: "accept",
    [ProtocolResolutionDecision.RESOLUTION_DECISION_REJECT]: "reject",
    [ProtocolResolutionDecision.UNRECOGNIZED]: null,
  },
  "Resolution decision",
);
export type ResolutionDecision = DomainEnum<typeof resolutionDecision>;

export const supertagRelationKind = defineProtocolEnum<ProtocolSupertagRelationKind>()(
  {
    [ProtocolSupertagRelationKind.SUPERTAG_RELATION_KIND_UNSPECIFIED]: null,
    [ProtocolSupertagRelationKind.SUPERTAG_RELATION_KIND_APPLICATION]: "application",
    [ProtocolSupertagRelationKind.SUPERTAG_RELATION_KIND_EXTENSION]: "extension",
    [ProtocolSupertagRelationKind.SUPERTAG_RELATION_KIND_TEMPLATE_NODE]: "template-node",
    [ProtocolSupertagRelationKind.SUPERTAG_RELATION_KIND_TEMPLATE_FIELD_VISIBILITY]: "template-field-visibility",
    [ProtocolSupertagRelationKind.SUPERTAG_RELATION_KIND_TEMPLATE_FIELD]: "template-field",
    [ProtocolSupertagRelationKind.SUPERTAG_RELATION_KIND_TEMPLATE_FIELD_STATIC_DEFAULT]:
      "template-field-static-default",
    [ProtocolSupertagRelationKind.SUPERTAG_RELATION_KIND_OPTIONAL_FIELD]: "optional-field",
    [ProtocolSupertagRelationKind.UNRECOGNIZED]: null,
  },
  "Supertag relation kind",
);
export type SupertagRelationKind = DomainEnum<typeof supertagRelationKind>;

export const diffSpaceKind = defineProtocolEnum<ProtocolDiffSpaceKind>()(
  {
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_UNSPECIFIED]: null,
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_NODE_CONTENT]: "node-content",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_CHILD_SEQUENCE]: "child-sequence",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_LIFECYCLE]: "lifecycle",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_OWNER]: "owner",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_SUPERTAG_APPLICATION]: "supertag-application",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_SUPERTAG_TEMPLATE]: "supertag-template",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_MATERIALIZED_FIELD]: "materialized-field",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_INLINE_REFERENCE]: "inline-reference",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_VIEW_DEFINITION]: "view-definition",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_FIELD_DEFINITION_CONFIGURATION]: "field-definition-configuration",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_SEARCH_EXPRESSION]: "search-expression",
    [ProtocolDiffSpaceKind.UNRECOGNIZED]: null,
  },
  "Diff space kind",
);
export type DiffSpaceKind = DomainEnum<typeof diffSpaceKind>;

export const recoveryAction = defineProtocolEnum<ProtocolRecoveryAction>()(
  {
    [ProtocolRecoveryAction.RECOVERY_ACTION_UNSPECIFIED]: null,
    [ProtocolRecoveryAction.RECOVERY_ACTION_RESTORE_SUPPORT]: "restore-support",
    [ProtocolRecoveryAction.UNRECOGNIZED]: null,
  },
  "Recovery action",
);
export type RecoveryAction = DomainEnum<typeof recoveryAction>;

export const placementEndpoint = defineProtocolEnum<ProtocolPlacementEndpoint>()(
  {
    [ProtocolPlacementEndpoint.PLACEMENT_ENDPOINT_UNSPECIFIED]: null,
    [ProtocolPlacementEndpoint.PLACEMENT_ENDPOINT_BEFORE]: "before",
    [ProtocolPlacementEndpoint.PLACEMENT_ENDPOINT_AFTER]: "after",
    [ProtocolPlacementEndpoint.PLACEMENT_ENDPOINT_MISSING]: "missing",
    [ProtocolPlacementEndpoint.UNRECOGNIZED]: null,
  },
  "Placement endpoint",
);
export type PlacementEndpoint = DomainEnum<typeof placementEndpoint>;
