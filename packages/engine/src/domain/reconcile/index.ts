export {
  CURRENT_PROJECTION_VERSIONS,
  PROJECTION_SECTION_NAMES,
  assertSupportedProjectionVersions,
} from "./projection-types.js";
export type {
  EffectiveField,
  MaterializedField,
  ProjectedNode,
  ProjectedOccurrence,
  Projection,
  ProjectionGeneration,
  ProjectionSectionName,
  ProjectionSections,
  ProjectionVersions,
  ScopedProjection,
  ScopedProjectionGeneration,
} from "./projection-types.js";
export {
  isProjectionSectionEntry,
  isProjectionSectionValue,
  parseProjectionSectionEntry,
  parseProjectionSectionValue,
} from "./projection-section-shape.js";
export { advanceGeneration, rebuildGeneration, snapshotAtFrontier } from "./reconcile.js";
export type { ReconcileResult } from "./reconcile.js";
export { impactAddress, valueKeyAddress, valueTargetAddress } from "./value-address.js";
export { assertMaterializedField } from "./materialized-field.js";
export { definitionNodeState } from "./definition-node.js";
export { occurrenceAnchor, sequenceAnchorAt } from "./sequence.js";
