import type {
  ContributionFact,
  Fact,
  ProjectionIdentity,
  ViewMode,
} from "../../domain/fact/index.js";
import type { ProjectionGeneration, ProjectionVersions } from "../../domain/reconcile/index.js";
import type { ProjectionPage, ProjectionQuery } from "../../application/contract.js";
import type { FactStore } from "../authority/fact-store.js";
import type { ProjectionCheckpointRepository } from "./projection-checkpoints.js";
import type { ProjectionSection } from "./materialized-generation-format.js";
import type { HistoryPlanningObserver } from "../../domain/history/index.js";
import type { ReviewEvidenceContext } from "../../domain/review/evidence.js";

export type ProjectionShardBatch = Readonly<{
  identity: ProjectionIdentity;
  entries: readonly Readonly<{ identity: string; value: unknown }>[];
}>;

export type ReviewGenerationPage = Readonly<{
  generation: ProjectionGeneration;
  pending: ReadonlyMap<string, ContributionFact>;
  context: ReviewEvidenceContext;
  facts: readonly Fact[];
  next: string | null;
}>;

export type ProjectionPublisher = Readonly<{
  publish(generation: ProjectionGeneration): Promise<void>;
}>;

export type ProjectionGenerationStore = ProjectionPublisher &
  Readonly<{
    load(generationId: string): Promise<ProjectionGeneration>;
    ownerCaches(generationId: string): Promise<ProjectionGeneration["ownerCaches"]>;
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
    page(generationId: string, query: ProjectionQuery): Promise<ProjectionPage>;
    schemaSearch(
      generationId: string,
      view: ViewMode,
      schemaId: string,
      after: string | null,
      limit: number,
    ): Promise<
      Readonly<{ identity: ProjectionIdentity; nodeIds: readonly string[]; next: string | null }>
    >;
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
