import {
  DiffSpaceKind as ProtocolDiffSpaceKind,
  PlacementEndpoint as ProtocolPlacementEndpoint,
  RecoveryAction as ProtocolRecoveryAction,
  ResolutionDecision as ProtocolResolutionDecision,
  SchemaRelationKind as ProtocolSchemaRelationKind,
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

export const schemaRelationKind = defineProtocolEnum<ProtocolSchemaRelationKind>()(
  {
    [ProtocolSchemaRelationKind.SCHEMA_RELATION_KIND_UNSPECIFIED]: null,
    [ProtocolSchemaRelationKind.SCHEMA_RELATION_KIND_APPLICATION]: "application",
    [ProtocolSchemaRelationKind.SCHEMA_RELATION_KIND_FIELD]: "field",
    [ProtocolSchemaRelationKind.SCHEMA_RELATION_KIND_EXTENSION]: "extension",
    [ProtocolSchemaRelationKind.SCHEMA_RELATION_KIND_TEMPLATE_NODE]: "template-node",
    [ProtocolSchemaRelationKind.UNRECOGNIZED]: null,
  },
  "Schema relation kind",
);
export type SchemaRelationKind = DomainEnum<typeof schemaRelationKind>;

export const diffSpaceKind = defineProtocolEnum<ProtocolDiffSpaceKind>()(
  {
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_UNSPECIFIED]: null,
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_NODE_CONTENT]: "node-content",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_CHILD_SEQUENCE]: "child-sequence",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_VALUE]: "value",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_LIFECYCLE]: "lifecycle",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_OWNER]: "owner",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_SCHEMA_APPLICATION]: "schema-application",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_SCHEMA_TEMPLATE]: "schema-template",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_FIELD_CONFIGURATION]: "field-configuration",
    [ProtocolDiffSpaceKind.DIFF_SPACE_KIND_MATERIALIZED_FIELD]: "materialized-field",
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
