import {
  canonicalDigest,
  type ProjectionIdentity,
  type ViewMode,
} from "../../domain/fact/index.js";
import type { ProjectionPlanCache } from "../../domain/reconcile/index.js";

export const MANIFEST_DOCUMENT_ID = "materialized-generation/manifest";
export const MANIFEST_FORMAT = "lode-materialized-generation-manifest-v1";
export const HEADER_FORMAT = "lode-materialized-generation-header-v14";
export const DIRECTORY_FORMAT = "lode-materialized-generation-directory-v2";
export const SHARD_FORMAT = "lode-materialized-generation-shard-v2";
export const PLAN_CACHE_FORMAT = "lode-materialized-generation-plan-cache-v1";
export const DIRECTORY_FANOUT = 16;

export const PROJECTION_SECTIONS = [
  "nodes",
  "occurrences",
  "children",
  "nodeOwners",
  "addressedValues",
  "schemaApplications",
  "schemaFields",
  "templateFields",
  "schemaTemplateNodes",
  "templateNodeInstances",
  "schemaExtensions",
  "schemaSearchMembers",
  "schemaExtensionConflicts",
  "nodeStatuses",
  "conflictIssues",
  "effectiveFields",
  "materializedFields",
  "reviewScopes",
  "supportByContribution",
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

export type ProjectionSection = (typeof PROJECTION_SECTIONS)[number];

export type ShardDescriptor = Readonly<{
  documentId: string;
  key: string;
  view: ViewMode;
  section: ProjectionSection;
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

export type DirectoryRoot = DirectoryNodeReference &
  Readonly<{
    view: ViewMode;
    section: ProjectionSection;
  }>;

export type StoredDirectoryNode = Readonly<{
  format: typeof DIRECTORY_FORMAT;
  generationId: string;
  contentDigest: string;
  view: ViewMode;
  section: ProjectionSection;
  level: number;
  count: number;
  minIdentity: string | null;
  maxIdentity: string | null;
  entries?: readonly ShardDescriptor[];
  children?: readonly DirectoryNodeReference[];
}>;

export type ProjectionHeader = Readonly<{
  view: ViewMode;
  identity: ProjectionIdentity;
}>;

export type GenerationHeader = Readonly<{
  format: typeof HEADER_FORMAT;
  contentDigest: string;
  identity: ProjectionIdentity;
  planCache: Readonly<{ documentId: string; contentDigest: string }>;
  directory: readonly DirectoryRoot[];
  origin: ProjectionHeader;
  review: ProjectionHeader;
}>;

export type StoredPlanCaches = Readonly<{
  format: typeof PLAN_CACHE_FORMAT;
  generationId: string;
  contentDigest: string;
  value: Readonly<{ origin: ProjectionPlanCache; review: ProjectionPlanCache }>;
}>;

export type StoredShard = Readonly<{
  format: typeof SHARD_FORMAT;
  generationId: string;
  key: string;
  contentDigest: string;
  value: unknown;
}>;

export type GenerationManifest = Readonly<{
  format: typeof MANIFEST_FORMAT;
  generationIds: readonly string[];
}>;

export type MaterializedGeneration = Readonly<{
  header: GenerationHeader;
  planCaches: StoredPlanCaches;
  shards: readonly Readonly<{ descriptor: ShardDescriptor; value: unknown }>[];
  directoryNodes: readonly StoredDirectoryNode[];
}>;

export function projectionShardKey(
  view: ViewMode,
  section: ProjectionSection,
  identity: string,
): string {
  return `${view}/${sectionKey(section)}/${identity}`;
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

export function planCacheDocumentId(generationId: string): string {
  return `materialized-generation/plan-cache/${generationId}`;
}

export function directoryNodeDocumentId(
  generationId: string,
  view: ViewMode,
  section: ProjectionSection,
  digest: string,
): string {
  return `${directoryPrefix(generationId, view, section)}${digest}`;
}

export function directoryPrefix(
  generationId: string,
  view?: ViewMode,
  section?: ProjectionSection,
): string {
  const base = `materialized-generation/directory/${generationId}/`;
  if (!view) {
    return base;
  }
  const viewPrefix = `${base}${view}/`;
  return section ? `${viewPrefix}${sectionKey(section)}/` : viewPrefix;
}

export function directoryRoot(
  header: GenerationHeader,
  view: ViewMode,
  section: ProjectionSection,
): DirectoryRoot {
  const root = header.directory.find(
    (candidate) => candidate.view === view && candidate.section === section,
  );
  if (!root) {
    throw new Error("Published Projection directory root is absent");
  }
  return root;
}

export function cacheKey(generationId: string, key: string): string {
  return `${generationId}\u0000${key}`;
}

export function encodeMaterialized(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function sectionKey(section: ProjectionSection): string {
  if (section === "nodes") {
    return "node";
  }
  if (section === "occurrences") {
    return "occurrence";
  }
  return section;
}
