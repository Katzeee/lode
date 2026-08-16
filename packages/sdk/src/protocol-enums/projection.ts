import {
  ProjectionSection as ProtocolProjectionSection,
  TemplateNodeState as ProtocolTemplateNodeState,
  ProjectionPerspective as ProtocolProjectionPerspective,
} from "@lode/protocol/dto/projection";
import { defineProtocolEnum, type DomainEnum } from "./enum-codec.js";

export const projectionPerspective = defineProtocolEnum<ProtocolProjectionPerspective>()(
  {
    [ProtocolProjectionPerspective.PROJECTION_PERSPECTIVE_UNSPECIFIED]: null,
    [ProtocolProjectionPerspective.PROJECTION_PERSPECTIVE_ORIGIN]: "origin",
    [ProtocolProjectionPerspective.PROJECTION_PERSPECTIVE_REVIEW]: "review",
    [ProtocolProjectionPerspective.UNRECOGNIZED]: null,
  },
  "Projection perspective",
);
export type ProjectionPerspective = DomainEnum<typeof projectionPerspective>;

export const projectionSection = defineProtocolEnum<ProtocolProjectionSection>()(
  {
    [ProtocolProjectionSection.PROJECTION_SECTION_UNSPECIFIED]: null,
    [ProtocolProjectionSection.PROJECTION_SECTION_NODES]: "nodes",
    [ProtocolProjectionSection.PROJECTION_SECTION_OCCURRENCES]: "occurrences",
    [ProtocolProjectionSection.PROJECTION_SECTION_CHILD_OCCURRENCES]: "childOccurrences",
    [ProtocolProjectionSection.PROJECTION_SECTION_NODE_OWNERS]: "nodeOwners",
    [ProtocolProjectionSection.PROJECTION_SECTION_SUPERTAG_APPLICATIONS]: "supertagApplications",
    [ProtocolProjectionSection.PROJECTION_SECTION_SUPERTAG_FIELDS]: "supertagFields",
    [ProtocolProjectionSection.PROJECTION_SECTION_TEMPLATE_FIELDS]: "templateFields",
    [ProtocolProjectionSection.PROJECTION_SECTION_SUPERTAG_TEMPLATE_NODES]: "supertagTemplateNodes",
    [ProtocolProjectionSection.PROJECTION_SECTION_TEMPLATE_NODE_INSTANCES]: "templateNodeInstances",
    [ProtocolProjectionSection.PROJECTION_SECTION_SUPERTAG_EXTENSIONS]: "supertagExtensions",
    [ProtocolProjectionSection.PROJECTION_SECTION_SUPERTAG_INSTANCE_SUPERTAGS]: "supertagInstanceSupertags",
    [ProtocolProjectionSection.PROJECTION_SECTION_SUPERTAG_EXTENSION_CONFLICTS]: "supertagExtensionConflicts",
    [ProtocolProjectionSection.PROJECTION_SECTION_CONFLICT_ISSUES]: "conflictIssues",
    [ProtocolProjectionSection.PROJECTION_SECTION_EFFECTIVE_FIELDS]: "effectiveFields",
    [ProtocolProjectionSection.PROJECTION_SECTION_MATERIALIZED_FIELDS]: "materializedFields",
    [ProtocolProjectionSection.PROJECTION_SECTION_WORKSPACE_SYSTEM_NODES]: "workspaceSystemNodes",
    [ProtocolProjectionSection.PROJECTION_SECTION_METANODES]: "metanodes",
    [ProtocolProjectionSection.PROJECTION_SECTION_SEARCH_CLAUSES]: "searchClauses",
    [ProtocolProjectionSection.PROJECTION_SECTION_SHARED_DEFAULT_VIEW_DEFINITIONS]: "sharedDefaultViewDefinitions",
    [ProtocolProjectionSection.PROJECTION_SECTION_FIELD_DEFINITION_CONFIGURATIONS]: "fieldDefinitionConfigurations",
    [ProtocolProjectionSection.UNRECOGNIZED]: null,
  },
  "Projection section",
);
export type ProjectionSection = DomainEnum<typeof projectionSection>;

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
