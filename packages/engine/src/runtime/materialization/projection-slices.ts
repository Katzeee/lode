import type { ProjectionIdentity } from "../../domain/fact/index.js";
import {
  PROJECTION_SECTION_NAMES,
  type ProjectionSectionName,
  type ProjectionSections,
} from "../../domain/reconcile/index.js";

export const PROJECTION_INDEX_NAMES = [
  "occurrenceIdsByNode",
  "nodeIdsByOwner",
  "nodeIdsBySchema",
  "nodeIdsByFieldDefinition",
  "schemaInstanceMemberships",
  "templateNodeInstancesByOwner",
  "templateNodeInstancesByTemplate",
  "templateNodeInstancesByNode",
  "templateNodeInstancesByOccurrence",
  "templateNodeInstancesBySchema",
] as const;

export type ProjectionIndexName = (typeof PROJECTION_INDEX_NAMES)[number];
export type ProjectionListIndexName = Exclude<ProjectionIndexName, "schemaInstanceMemberships">;
export type ProjectionSliceName = ProjectionSectionName | ProjectionIndexName;

type ProjectionSectionValue<Section extends ProjectionSectionName> =
  ProjectionSections[Section] extends readonly (infer Value)[]
    ? Value
    : ProjectionSections[Section] extends Readonly<Record<string, infer Value>>
      ? Value
      : never;

export type ProjectionSliceValue<Section extends ProjectionSliceName> = Section extends ProjectionSectionName
  ? ProjectionSectionValue<Section>
  : Section extends "schemaInstanceMemberships"
    ? string
    : readonly string[];

export const PROJECTION_SLICE_NAMES = [
  ...PROJECTION_SECTION_NAMES,
  ...PROJECTION_INDEX_NAMES,
] as const satisfies readonly ProjectionSliceName[];

export type ProjectionShardBatch<Section extends ProjectionSliceName = ProjectionSliceName> = Readonly<{
  identity: ProjectionIdentity;
  entries: readonly Readonly<{ identity: string; value: ProjectionSliceValue<Section> }>[];
}>;

export type ProjectionSlicePage<Section extends ProjectionSliceName = ProjectionSliceName> =
  ProjectionShardBatch<Section> &
    Readonly<{
      next: string | null;
    }>;
