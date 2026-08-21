import { canonicalDigest } from "../../../../../domain/fact/index.js";
import type {
  MaterializedDataset,
  MaterializedDatasetCatalog,
  MaterializedDatasetRoot,
} from "./materialized-dataset.js";
import { sameMaterializedDatasetRoot } from "./materialized-dataset.js";
import {
  SHARD_FORMAT,
  materializedShardKey,
  shardDocumentId,
  type ShardDescriptor,
  type StoredShard,
} from "./materialized-generation-format.js";
import { hasExactKeys } from "../../../../../decoding/index.js";

export function isStoredShard<Value>(
  value: unknown,
  generationId: string,
  descriptor: ShardDescriptor,
  dataset: MaterializedDataset<Value>,
): value is StoredShard<Value> {
  return (
    hasExactKeys(value, ["format", "generationId", "key", "contentDigest", "value"]) &&
    value.format === SHARD_FORMAT &&
    value.generationId === generationId &&
    value.key === descriptor.key &&
    value.contentDigest === descriptor.contentDigest &&
    canonicalDigest(value.value) === descriptor.contentDigest &&
    sameMaterializedDatasetRoot(descriptor, dataset.root) &&
    dataset.isValue(descriptor.identity, value.value)
  );
}

export function isShardDescriptor<Identity>(
  value: unknown,
  generationId: string,
  catalog: MaterializedDatasetCatalog<Identity>,
  root?: MaterializedDatasetRoot,
): value is ShardDescriptor {
  if (
    !hasExactKeys(value, ["documentId", "key", "dataset", "partition", "section", "identity", "contentDigest"]) ||
    typeof value.documentId !== "string" ||
    typeof value.key !== "string" ||
    typeof value.dataset !== "string" ||
    typeof value.partition !== "string" ||
    typeof value.section !== "string" ||
    typeof value.identity !== "string" ||
    typeof value.contentDigest !== "string"
  ) {
    return false;
  }
  const descriptorRoot: MaterializedDatasetRoot = {
    dataset: value.dataset,
    partition: value.partition,
    section: value.section,
  };
  if (!catalog.isRoot(descriptorRoot) || (root !== undefined && !sameMaterializedDatasetRoot(descriptorRoot, root))) {
    return false;
  }
  const key = materializedShardKey(descriptorRoot, value.identity);
  return value.key === key && value.documentId === shardDocumentId(generationId, key);
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
