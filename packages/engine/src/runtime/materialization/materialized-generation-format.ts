import { canonicalDigest } from "../../domain/fact/index.js";
import type { MaterializedDatasetRoot } from "./materialized-dataset.js";
import { sameMaterializedDatasetRoot } from "./materialized-dataset.js";

export const MANIFEST_DOCUMENT_ID = "materialized-generation/manifest";
export const MANIFEST_FORMAT = "lode-materialized-generation-manifest-v1";
export const HEADER_FORMAT = "lode-materialized-generation-header-v16";
export const DIRECTORY_FORMAT = "lode-materialized-generation-directory-v3";
export const SHARD_FORMAT = "lode-materialized-generation-shard-v3";
export const DIRECTORY_FANOUT = 16;

export type ShardDescriptor = MaterializedDatasetRoot &
  Readonly<{
    documentId: string;
    key: string;
    identity: string;
    contentDigest: string;
  }>;

export type DirectoryNodeReference = Readonly<{
  documentId: string;
  contentDigest: string;
  level: number;
  count: number;
  minIdentity: string | null;
  maxIdentity: string | null;
}>;

export type DirectoryRoot = DirectoryNodeReference & MaterializedDatasetRoot;

export type StoredDirectoryNode = MaterializedDatasetRoot &
  Readonly<{
    format: typeof DIRECTORY_FORMAT;
    generationId: string;
    contentDigest: string;
    level: number;
    count: number;
    minIdentity: string | null;
    maxIdentity: string | null;
    entries?: readonly ShardDescriptor[];
    children?: readonly DirectoryNodeReference[];
  }>;

export type GenerationHeader<Identity = unknown> = Readonly<{
  format: typeof HEADER_FORMAT;
  contentDigest: string;
  identity: Identity;
  directory: readonly DirectoryRoot[];
}>;

export type StoredShard<Value = unknown> = Readonly<{
  format: typeof SHARD_FORMAT;
  generationId: string;
  key: string;
  contentDigest: string;
  value: Value;
}>;

export type GenerationManifest = Readonly<{
  format: typeof MANIFEST_FORMAT;
  generationIds: readonly string[];
}>;

export type MaterializedGeneration<Identity = unknown> = Readonly<{
  header: GenerationHeader<Identity>;
  shards: readonly Readonly<{ descriptor: ShardDescriptor; value: unknown }>[];
  directoryNodes: readonly StoredDirectoryNode[];
}>;

export function materializedShardKey(root: MaterializedDatasetRoot, identity: string): string {
  return `${rootKey(root)}/${identity}`;
}

export function headerDocumentId(generationId: string): string {
  return `materialized-generation/header/${generationId}`;
}

export function shardDocumentId(generationId: string, key: string): string {
  return `${shardPrefix(generationId)}${canonicalDigest(key)}`;
}

export function shardPrefix(generationId: string): string {
  return `materialized-generation/shard/${generationId}/`;
}

export function directoryNodeDocumentId(generationId: string, root: MaterializedDatasetRoot, digest: string): string {
  return `${directoryPrefix(generationId, root)}${digest}`;
}

export function directoryPrefix(generationId: string, root?: MaterializedDatasetRoot): string {
  const base = `materialized-generation/directory/${generationId}/`;
  return root ? `${base}${rootKey(root)}/` : base;
}

export function directoryRoot(header: GenerationHeader, root: MaterializedDatasetRoot): DirectoryRoot {
  const found = header.directory.find((candidate) => sameMaterializedDatasetRoot(candidate, root));
  if (!found) {
    throw new Error("Published materialized dataset directory root is absent");
  }
  return found;
}

export function cacheKey(generationId: string, key: string): string {
  return `${generationId}\u0000${key}`;
}

export function encodeMaterialized(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function rootKey(root: MaterializedDatasetRoot): string {
  return [root.dataset, root.partition, root.section].map(encodeURIComponent).join("/");
}
