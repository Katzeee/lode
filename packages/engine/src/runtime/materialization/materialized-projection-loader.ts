import type { Projection } from "../../domain/reconcile/index.js";
import type { ProjectionHeader, ShardDescriptor } from "./materialized-generation-format.js";
import { isProjectionIndexSection } from "./materialized-projection-index.js";
import {
  assignMaterializedProjectionValue,
  emptyMaterializedProjection,
} from "./materialized-projection-section-codec.js";
import { isReviewReadModelSection } from "./materialized-review-read-model.js";

export async function loadMaterializedProjection(
  header: ProjectionHeader,
  descriptors: readonly ShardDescriptor[],
  load: (descriptor: ShardDescriptor) => Promise<unknown>,
): Promise<Projection> {
  const projection = emptyMaterializedProjection(header.view, header.identity);
  for (const descriptor of descriptors) {
    assignMaterializedValue(projection, descriptor, await load(descriptor));
  }
  return projection;
}

function assignMaterializedValue(
  projection: Projection,
  descriptor: ShardDescriptor,
  value: unknown,
): void {
  if (
    isProjectionIndexSection(descriptor.section) ||
    isReviewReadModelSection(descriptor.section)
  ) {
    return;
  }
  assignMaterializedProjectionValue(projection, descriptor.section, descriptor.identity, value);
}
