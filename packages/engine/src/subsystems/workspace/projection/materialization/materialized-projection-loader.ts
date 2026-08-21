import type { ProjectionIdentity, ProjectionPerspective } from "../../../../domain/fact/index.js";
import {
  PROJECTION_SECTION_NAMES,
  type Projection,
  type ProjectionSectionName,
} from "../../../../domain/reconcile/index.js";
import type { LoadedMaterializedEntry } from "./store/bounded-materialized-store.js";
import { isProjectionLookupIndexSection } from "./materialized-projection-index.js";
import {
  assignMaterializedProjectionValue,
  emptyMaterializedProjection,
} from "./materialized-projection-section-codec.js";

export function loadMaterializedProjection(
  perspective: ProjectionPerspective,
  identity: ProjectionIdentity,
  entries: readonly LoadedMaterializedEntry[],
): Projection {
  const projection = emptyMaterializedProjection(perspective, identity);
  for (const entry of entries) {
    assignMaterializedValue(projection, entry);
  }
  return projection;
}

function assignMaterializedValue(projection: Projection, entry: LoadedMaterializedEntry): void {
  const section = entry.descriptor.section;
  if (isProjectionLookupIndexSection(section) || !isProjectionSection(section)) {
    return;
  }
  assignMaterializedProjectionValue(projection, section, entry.descriptor.identity, entry.value);
}

function isProjectionSection(section: string): section is ProjectionSectionName {
  return PROJECTION_SECTION_NAMES.includes(section as ProjectionSectionName);
}
