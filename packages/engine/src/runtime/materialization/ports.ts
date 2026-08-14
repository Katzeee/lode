import type { ProjectionPage, ProjectionQuery } from "../../application/contract.js";
import type { FactSnapshot, ProjectionIdentity, ViewMode } from "../../domain/fact/index.js";
import type { ReviewReadModel } from "../../domain/review/index.js";
import {
  PROJECTION_SECTION_NAMES,
  type ProjectionGeneration,
  type ProjectionSectionName,
  type ProjectionSections,
  type ProjectionVersions,
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

export type ProjectionSliceValue<Section extends ProjectionSliceName> =
  Section extends ProjectionSectionName
    ? ProjectionSectionValue<Section>
    : Section extends "schemaInstanceMemberships"
      ? string
      : readonly string[];

export const PROJECTION_SLICE_NAMES = [
  ...PROJECTION_SECTION_NAMES,
  ...PROJECTION_INDEX_NAMES,
] as const satisfies readonly ProjectionSliceName[];

export type ProjectionShardBatch<Section extends ProjectionSliceName = ProjectionSliceName> =
  Readonly<{
    identity: ProjectionIdentity;
    entries: readonly Readonly<{ identity: string; value: ProjectionSliceValue<Section> }>[];
  }>;

export type ProjectionPublisher = Readonly<{
  publish(generation: ProjectionGeneration, review: ReviewReadModel): Promise<void>;
}>;

export type ProjectionCheckpointLoad =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "invalid"; reason: string }>
  | Readonly<{ kind: "valid"; generation: ProjectionGeneration }>;

export type ProjectionCheckpointStore = Readonly<{
  load(snapshot: FactSnapshot, versions: ProjectionVersions): Promise<ProjectionCheckpointLoad>;
  save(snapshot: FactSnapshot, generation: ProjectionGeneration): Promise<void>;
}>;

export type ProjectionGenerationReader = Readonly<{
  load(generationId: string): Promise<ProjectionGeneration>;
}>;

export type ProjectionIdentityReader = Readonly<{
  identity(generationId: string): Promise<ProjectionIdentity>;
}>;

export type ProjectionSnapshotReader = Readonly<{
  read<Section extends ProjectionSliceName>(
    generationId: string,
    view: ViewMode,
    section: Section,
    identities: readonly string[],
  ): Promise<ProjectionShardBatch<Section>>;
  withReadLease<T>(generationId: string, read: () => Promise<T>): Promise<T>;
}>;

export type ProjectionPageReader = Readonly<{
  page(generationId: string, query: ProjectionQuery): Promise<ProjectionPage>;
}>;

export type ReviewReadModelReader = Readonly<{
  reviewScopes(
    generationId: string,
    after: string | null,
    limit: number,
  ): Promise<
    Readonly<{
      identity: ProjectionIdentity;
      scopes: readonly Readonly<{ identity: string; contributionIds: readonly string[] }>[];
      next: string | null;
    }>
  >;
  reviewSupport(
    generationId: string,
    contributionIds: readonly string[],
  ): Promise<
    Readonly<{
      identity: ProjectionIdentity;
      entries: readonly Readonly<{ identity: string; supportIds: readonly string[] }>[];
    }>
  >;
}>;

export type ProjectionSchemaSearchReader = Readonly<{
  schemaSearch(
    generationId: string,
    view: ViewMode,
    schemaId: string,
    after: string | null,
    limit: number,
  ): Promise<
    Readonly<{ identity: ProjectionIdentity; nodeIds: readonly string[]; next: string | null }>
  >;
}>;
