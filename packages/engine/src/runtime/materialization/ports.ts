import type { FactSnapshot, ProjectionIdentity, ProjectionPerspective } from "../../domain/fact/index.js";
import type { ReviewReadModel } from "../../domain/review/index.js";
import {
  type ProjectionGeneration,
  type ProjectionSectionName,
  type ProjectionVersions,
} from "../../domain/reconcile/index.js";
import type { ProjectionShardBatch, ProjectionSliceName, ProjectionSlicePage } from "./projection-slices.js";

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
    perspective: ProjectionPerspective,
    section: Section,
    identities: readonly string[],
  ): Promise<ProjectionShardBatch<Section>>;
  withReadLease<T>(generationId: string, read: () => Promise<T>): Promise<T>;
}>;

export type ProjectionSectionPageReader = Readonly<{
  page<Section extends ProjectionSectionName>(
    generationId: string,
    perspective: ProjectionPerspective,
    section: Section,
    after: string | null,
    limit: number,
  ): Promise<ProjectionSlicePage<Section>>;
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

export type ProjectionSupertagInstancesReader = Readonly<{
  supertagInstances(
    generationId: string,
    perspective: ProjectionPerspective,
    supertagId: string,
    after: string | null,
    limit: number,
  ): Promise<Readonly<{ identity: ProjectionIdentity; nodeIds: readonly string[]; next: string | null }>>;
}>;
