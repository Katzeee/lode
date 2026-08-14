import type { ViewMode } from "../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import { loadPageDescriptors } from "./materialized-directory.js";
import {
  directoryRoot,
  type GenerationHeader,
  type ShardDescriptor,
} from "./materialized-generation-format.js";

export async function readSchemaSearchPage(
  documents: DocumentStore,
  generationId: string,
  view: ViewMode,
  schemaId: string,
  after: string | null,
  limit: number,
  header: GenerationHeader,
  loadShard: (descriptor: ShardDescriptor) => Promise<unknown>,
) {
  const prefix = `${encodeURIComponent(schemaId)}/`;
  const page = await loadPageDescriptors(
    documents,
    generationId,
    view,
    "schemaInstanceMemberships",
    directoryRoot(header, view, "schemaInstanceMemberships"),
    after === null ? prefix : `${prefix}${encodeURIComponent(after)}`,
    limit + 1,
  );
  const matches = page.descriptors.filter((descriptor) => descriptor.identity.startsWith(prefix));
  const selected = matches.slice(0, limit);
  const nodeIds = [];
  for (const descriptor of selected) {
    const nodeId = await loadShard(descriptor);
    if (typeof nodeId !== "string") {
      throw new Error("Schema Search index value is invalid");
    }
    nodeIds.push(nodeId);
  }
  return {
    identity: header.identity,
    nodeIds,
    next: matches.length > selected.length ? (nodeIds.at(-1) ?? null) : null,
  };
}
