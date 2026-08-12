import type { ProjectionIdentity, ViewMode } from "../../domain/fact/index.js";
import type { ProjectionGeneration, ProjectionVersions } from "../../domain/reconcile/index.js";
import type { ProjectionPage, ProjectionQuery } from "../../application/contract.js";
import type { FactStore } from "../authority/fact-store.js";
import type { ProjectionCheckpointRepository } from "./projection-checkpoints.js";
import type { ProjectionSection } from "./materialized-generation-format.js";
import type { HistoryPlanningObserver } from "../../domain/history/index.js";

export type ProjectionShardBatch = Readonly<{
  identity: ProjectionIdentity;
  entries: readonly Readonly<{ identity: string; value: unknown }>[];
}>;

export type ProjectionPublisher = Readonly<{
  publish(generation: ProjectionGeneration): Promise<void>;
}>;

export type ProjectionGenerationStore = ProjectionPublisher &
  Readonly<{
    load(generationId: string): Promise<ProjectionGeneration>;
    page(generationId: string, query: ProjectionQuery): Promise<ProjectionPage>;
    read(
      generationId: string,
      view: ViewMode,
      section: ProjectionSection,
      identities: readonly string[],
    ): Promise<ProjectionShardBatch>;
    withReadLease<T>(generationId: string, read: () => Promise<T>): Promise<T>;
  }>;

export type ProposalWorkspaceOptions = Readonly<{
  workspaceId: string;
  facts: FactStore;
  versions: ProjectionVersions;
  reviewCapabilityKey?: string;
  publisher?: ProjectionPublisher;
  generations?: ProjectionGenerationStore;
  checkpoints?: ProjectionCheckpointRepository;
  publicationTimeoutMs?: number;
  historyPlanningObserver?: HistoryPlanningObserver;
}>;
