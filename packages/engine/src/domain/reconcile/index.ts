export { CURRENT_PROJECTION_VERSIONS, PROJECTION_SECTION_NAMES } from "./projection-types.js";
export type {
  FieldDefinitionConfiguration,
  InlineReferenceTargetStatus,
  MaterializedField,
  ProjectedNode,
  ProjectedOccurrence,
  Projection,
  ProjectionGeneration,
  ProjectionSectionName,
  ProjectionSections,
  ProjectionVersions,
  TemplateField,
  SearchExpression,
  SharedDefaultViewDefinition,
  ScopedProjection,
  ScopedProjectionGeneration,
} from "./projection-types.js";
export { isProjectionSectionEntry, isProjectionSectionValue } from "./projection-section-shape.js";
export { advanceGeneration, rebuildGeneration, snapshotAtFrontier } from "./reconcile.js";
export {
  fieldConfigurationProjectionIdentity,
  metanodeHostNodeId,
  metanodeNodeId,
  projectionIdentity,
} from "./projection-identity.js";
export { searchExpressionActionId, searchExpressionProjectionIdentity } from "./search-expression-graph.js";
export {
  viewProjectionIdentity,
  viewColumnNodeId,
  viewSortNodeId,
  viewGroupNodeId,
  viewFilterNodeId,
} from "./view-definition-graph.js";
export { impactAddress } from "./impact-address.js";
export { assertMaterializedField } from "./materialized-field.js";
export { projectFieldAvailability } from "./field-availability.js";
export { definitionNodeState } from "./definition-node.js";
export { occurrenceAnchor, sequenceAnchorAt } from "./sequence.js";
export { isPresentNodeOutsideTrash, locateInlineReference, nodeLocation, textAtoms } from "./node-graph.js";
