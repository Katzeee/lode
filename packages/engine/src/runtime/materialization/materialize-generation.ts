import { canonicalDigest, stableStringCompare, type ViewMode } from "../../domain/fact/index.js";
import { type Projection, type ProjectionGeneration } from "../../domain/reconcile/index.js";
import type { ReviewReadModel } from "../../domain/review/index.js";
import {
  DIRECTORY_FANOUT,
  DIRECTORY_FORMAT,
  HEADER_FORMAT,
  PLAN_CACHE_FORMAT,
  MATERIALIZED_DIRECTORY_ROOTS,
  directoryNodeDocumentId,
  planCacheDocumentId,
  projectionShardKey,
  shardDocumentId,
  type DirectoryNodeReference,
  type DirectoryRoot,
  type GenerationHeader,
  type MaterializedGeneration,
  type MaterializedSection,
  type ShardDescriptor,
  type StoredDirectoryNode,
} from "./materialized-generation-format.js";
import { projectionIndexEntries } from "./materialized-projection-index.js";
import { materializedProjectionEntries } from "./materialized-projection-section-codec.js";
import { materializedReviewReadModelEntries } from "./materialized-review-read-model.js";

export function materialize(
  generation: ProjectionGeneration,
  reviewReadModel: ReviewReadModel,
): MaterializedGeneration {
  const shards = [
    ...projectionShards(generation.identity.generationId, generation.origin),
    ...projectionShards(generation.identity.generationId, generation.review),
    ...reviewReadModelShards(generation.identity.generationId, reviewReadModel),
  ].sort((left, right) => stableStringCompare(left.descriptor.key, right.descriptor.key));
  const directory = buildDirectory(
    generation.identity.generationId,
    shards.map((shard) => shard.descriptor),
  );
  return {
    header: withHeaderDigest({
      format: HEADER_FORMAT,
      identity: generation.identity,
      planCache: {
        documentId: planCacheDocumentId(generation.identity.generationId),
        contentDigest: canonicalDigest(generation.planCaches),
      },
      directory: directory.roots,
      origin: { view: "origin", identity: generation.origin.identity },
      review: { view: "review", identity: generation.review.identity },
    }),
    planCaches: {
      format: PLAN_CACHE_FORMAT,
      generationId: generation.identity.generationId,
      contentDigest: canonicalDigest(generation.planCaches),
      value: generation.planCaches,
    },
    shards,
    directoryNodes: directory.nodes,
  };
}

function buildDirectory(
  generationId: string,
  descriptors: readonly ShardDescriptor[],
): Readonly<{ roots: readonly DirectoryRoot[]; nodes: readonly StoredDirectoryNode[] }> {
  const roots: DirectoryRoot[] = [];
  const nodes: StoredDirectoryNode[] = [];
  for (const { view, section } of MATERIALIZED_DIRECTORY_ROOTS) {
    const selected = descriptors
      .filter((descriptor) => descriptor.view === view && descriptor.section === section)
      .sort((left, right) => stableStringCompare(left.identity, right.identity));
    const tree = buildDirectoryTree(generationId, view, section, selected);
    roots.push({ ...tree.root, view, section });
    nodes.push(...tree.nodes);
  }
  return { roots, nodes };
}

function buildDirectoryTree(
  generationId: string,
  view: ViewMode,
  section: MaterializedSection,
  descriptors: readonly ShardDescriptor[],
): Readonly<{ root: DirectoryNodeReference; nodes: readonly StoredDirectoryNode[] }> {
  const nodes: StoredDirectoryNode[] = [];
  let level = chunk(descriptors, DIRECTORY_FANOUT).map((entries) => {
    const node = directoryNode(generationId, view, section, 0, entries, undefined);
    nodes.push(node);
    return directoryNodeReference(generationId, node);
  });
  if (level.length === 0) {
    const node = directoryNode(generationId, view, section, 0, [], undefined);
    nodes.push(node);
    level = [directoryNodeReference(generationId, node)];
  }
  while (level.length > 1) {
    level = chunk(level, DIRECTORY_FANOUT).map((children) => {
      const node = directoryNode(
        generationId,
        view,
        section,
        (children[0]?.level ?? 0) + 1,
        undefined,
        children,
      );
      nodes.push(node);
      return directoryNodeReference(generationId, node);
    });
  }
  const root = level[0];
  if (!root) {
    throw new Error("Materialized directory root is absent");
  }
  return { root, nodes };
}

function directoryNode(
  generationId: string,
  view: ViewMode,
  section: MaterializedSection,
  level: number,
  entries: readonly ShardDescriptor[] | undefined,
  children: readonly DirectoryNodeReference[] | undefined,
): StoredDirectoryNode {
  const count = entries
    ? entries.length
    : (children?.reduce((sum, child) => sum + child.count, 0) ?? 0);
  const minIdentity = entries
    ? (entries[0]?.identity ?? null)
    : (children?.[0]?.minIdentity ?? null);
  const maxIdentity = entries
    ? (entries.at(-1)?.identity ?? null)
    : (children?.at(-1)?.maxIdentity ?? null);
  const content: Omit<StoredDirectoryNode, "contentDigest"> = {
    format: DIRECTORY_FORMAT,
    generationId,
    view,
    section,
    level,
    count,
    minIdentity,
    maxIdentity,
    ...(entries ? { entries } : { children: children ?? [] }),
  };
  return { ...content, contentDigest: canonicalDigest(content) };
}

function directoryNodeReference(
  generationId: string,
  node: StoredDirectoryNode,
): DirectoryNodeReference {
  return {
    documentId: directoryNodeDocumentId(generationId, node.view, node.section, node.contentDigest),
    contentDigest: node.contentDigest,
    level: node.level,
    count: node.count,
    minIdentity: node.minIdentity,
    maxIdentity: node.maxIdentity,
  };
}

function chunk<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function projectionShards(
  generationId: string,
  projection: Projection,
): readonly Readonly<{ descriptor: ShardDescriptor; value: unknown }>[] {
  const entries = [
    ...materializedProjectionEntries(projection),
    ...projectionIndexEntries(projection),
  ];
  return entries.map(({ section, identity, value }) => {
    const key = projectionShardKey(projection.view, section, identity);
    return {
      descriptor: {
        documentId: shardDocumentId(generationId, key),
        key,
        view: projection.view,
        section,
        identity,
        contentDigest: canonicalDigest(value),
      },
      value,
    };
  });
}

function reviewReadModelShards(
  generationId: string,
  model: ReviewReadModel,
): readonly Readonly<{ descriptor: ShardDescriptor; value: unknown }>[] {
  return materializedReviewReadModelEntries(model).map(({ section, identity, value }) => {
    const key = projectionShardKey("review", section, identity);
    return {
      descriptor: {
        documentId: shardDocumentId(generationId, key),
        key,
        view: "review",
        section,
        identity,
        contentDigest: canonicalDigest(value),
      },
      value,
    };
  });
}

function withHeaderDigest(header: Omit<GenerationHeader, "contentDigest">): GenerationHeader {
  return { ...header, contentDigest: canonicalDigest(header) };
}
