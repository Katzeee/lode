export {
  CURRENT_PROJECTION_VERSIONS,
  PROJECTION_SECTION_NAMES,
  assertSupportedProjectionVersions,
} from "./projection-types.js";
export type {
  ConflictProjection,
  FieldProjection,
  FieldDefinitionConfiguration,
  InlineReferenceTargetStatus,
  MaterializedField,
  TypedFieldValue,
  TypedFieldSemanticValue,
  NodeGraph,
  ProjectedNode,
  ProjectedInlineReference,
  NodeContentItem,
  ProjectedOccurrence,
  Projection,
  ProjectionGeneration,
  ProjectionSectionName,
  ProjectionSections,
  ProjectionVersions,
  SupertagProjection,
  SearchExpression,
  SearchProjection,
  ScopedProjection,
  ScopedProjectionGeneration,
  WorkspaceSystemNodeProjection,
} from "./projection-types.js";
export {
  isProjectionSectionEntry,
  isProjectionSectionValue,
  parseProjectionSectionEntry,
  parseProjectionSectionValue,
} from "./projection-section-shape.js";
export { advanceGeneration, rebuildGeneration, snapshotAtFrontier } from "./reconcile.js";
export type { ReconcileResult } from "./reconcile.js";
export { impactAddress } from "./impact-address.js";
export { assertMaterializedField } from "./materialized-field.js";
export { projectFieldAvailability } from "./field-availability.js";
export { definitionNodeState } from "./definition-node.js";
export { occurrenceAnchor, sequenceAnchorAt } from "./sequence.js";
export {
  isActiveNode,
  isNodeInTrash,
  isPresentNodeOutsideTrash,
  locateInlineReference,
  nodeLocation,
  textAtoms,
} from "./node-graph.js";
export {
  WORKSPACE_SYSTEM_NODE_ROLES,
  projectWorkspaceSystemNodes,
  type WorkspaceSystemNodeRole,
  type WorkspaceSystemNodes,
} from "./workspace-system-nodes.js";
