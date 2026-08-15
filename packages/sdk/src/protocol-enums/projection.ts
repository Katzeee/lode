import {
  NodeState as ProtocolNodeState,
  ProjectionSection as ProtocolProjectionSection,
  TemplateNodeState as ProtocolTemplateNodeState,
  ViewFieldState as ProtocolViewFieldState,
  ViewLayout as ProtocolViewLayout,
  ViewMode as ProtocolViewMode,
} from "@lode/protocol/dto/projection";
import { defineProtocolEnum, type DomainEnum } from "./enum-codec.js";

export const viewMode = defineProtocolEnum<ProtocolViewMode>()(
  {
    [ProtocolViewMode.VIEW_MODE_UNSPECIFIED]: null,
    [ProtocolViewMode.VIEW_MODE_ORIGIN]: "origin",
    [ProtocolViewMode.VIEW_MODE_REVIEW]: "review",
    [ProtocolViewMode.UNRECOGNIZED]: null,
  },
  "View mode",
);
export type ViewMode = DomainEnum<typeof viewMode>;

export const projectionSection = defineProtocolEnum<ProtocolProjectionSection>()(
  {
    [ProtocolProjectionSection.PROJECTION_SECTION_UNSPECIFIED]: null,
    [ProtocolProjectionSection.PROJECTION_SECTION_NODES]: "nodes",
    [ProtocolProjectionSection.PROJECTION_SECTION_OCCURRENCES]: "occurrences",
    [ProtocolProjectionSection.PROJECTION_SECTION_CHILDREN]: "children",
    [ProtocolProjectionSection.PROJECTION_SECTION_NODE_OWNERS]: "nodeOwners",
    [ProtocolProjectionSection.PROJECTION_SECTION_ADDRESSED_VALUES]: "addressedValues",
    [ProtocolProjectionSection.PROJECTION_SECTION_SCHEMA_APPLICATIONS]: "schemaApplications",
    [ProtocolProjectionSection.PROJECTION_SECTION_SCHEMA_FIELDS]: "schemaFields",
    [ProtocolProjectionSection.PROJECTION_SECTION_TEMPLATE_FIELDS]: "templateFields",
    [ProtocolProjectionSection.PROJECTION_SECTION_SCHEMA_TEMPLATE_NODES]: "schemaTemplateNodes",
    [ProtocolProjectionSection.PROJECTION_SECTION_TEMPLATE_NODE_INSTANCES]: "templateNodeInstances",
    [ProtocolProjectionSection.PROJECTION_SECTION_SCHEMA_EXTENSIONS]: "schemaExtensions",
    [ProtocolProjectionSection.PROJECTION_SECTION_SCHEMA_SEARCH_MEMBERS]: "schemaSearchMembers",
    [ProtocolProjectionSection.PROJECTION_SECTION_SCHEMA_EXTENSION_CONFLICTS]: "schemaExtensionConflicts",
    [ProtocolProjectionSection.PROJECTION_SECTION_NODE_STATUSES]: "nodeStatuses",
    [ProtocolProjectionSection.PROJECTION_SECTION_CONFLICT_ISSUES]: "conflictIssues",
    [ProtocolProjectionSection.PROJECTION_SECTION_EFFECTIVE_FIELDS]: "effectiveFields",
    [ProtocolProjectionSection.PROJECTION_SECTION_MATERIALIZED_FIELDS]: "materializedFields",
    [ProtocolProjectionSection.UNRECOGNIZED]: null,
  },
  "Projection section",
);
export type ProjectionSection = DomainEnum<typeof projectionSection>;

export const nodeState = defineProtocolEnum<ProtocolNodeState>()(
  {
    [ProtocolNodeState.NODE_STATE_UNSPECIFIED]: null,
    [ProtocolNodeState.NODE_STATE_ACTIVE]: "active",
    [ProtocolNodeState.NODE_STATE_DELETED]: "deleted",
    [ProtocolNodeState.UNRECOGNIZED]: null,
  },
  "Node state",
);
export type NodeState = DomainEnum<typeof nodeState>;

export const templateNodeState = defineProtocolEnum<ProtocolTemplateNodeState>()(
  {
    [ProtocolTemplateNodeState.TEMPLATE_NODE_STATE_UNSPECIFIED]: null,
    [ProtocolTemplateNodeState.TEMPLATE_NODE_STATE_LINKED]: "linked",
    [ProtocolTemplateNodeState.TEMPLATE_NODE_STATE_DETACHED]: "detached",
    [ProtocolTemplateNodeState.UNRECOGNIZED]: null,
  },
  "Template Node state",
);
export type TemplateNodeState = DomainEnum<typeof templateNodeState>;

export const viewLayout = defineProtocolEnum<ProtocolViewLayout>()(
  {
    [ProtocolViewLayout.VIEW_LAYOUT_UNSPECIFIED]: null,
    [ProtocolViewLayout.VIEW_LAYOUT_TABLE]: "table",
    [ProtocolViewLayout.VIEW_LAYOUT_CARDS]: "cards",
    [ProtocolViewLayout.VIEW_LAYOUT_CALENDAR]: "calendar",
    [ProtocolViewLayout.UNRECOGNIZED]: null,
  },
  "View layout",
);
export type ViewLayout = DomainEnum<typeof viewLayout>;

export const viewFieldState = defineProtocolEnum<ProtocolViewFieldState>()(
  {
    [ProtocolViewFieldState.VIEW_FIELD_STATE_UNSPECIFIED]: null,
    [ProtocolViewFieldState.VIEW_FIELD_STATE_ABSENT]: "absent",
    [ProtocolViewFieldState.VIEW_FIELD_STATE_PLACEHOLDER]: "placeholder",
    [ProtocolViewFieldState.VIEW_FIELD_STATE_MATERIALIZED]: "materialized",
    [ProtocolViewFieldState.UNRECOGNIZED]: null,
  },
  "View field state",
);
export type ViewFieldState = DomainEnum<typeof viewFieldState>;
