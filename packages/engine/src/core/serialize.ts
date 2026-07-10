import type { Engine } from "./engine.js";
import { NotFoundError } from "../errors/index.js";
import type {
  DocSnapshot,
  NodeEntitySnapshot,
  NodeOccurrence,
  NodeOccurrenceSnapshot,
  OccurrenceId,
} from "./types.js";

export async function toJSON(
  engine: Engine,
  rootOccurrenceId?: OccurrenceId,
): Promise<DocSnapshot> {
  const roots =
    rootOccurrenceId != null
      ? [await engine.getOccurrence(rootOccurrenceId)].filter(
          (node): node is NodeOccurrence => node != null,
        )
      : await engine.getRootOccurrences();
  const entities = new Map<string, NodeEntitySnapshot>();
  const occurrences = new Map<string, NodeOccurrenceSnapshot>();

  const visit = async (node: NodeOccurrence): Promise<void> => {
    entities.set(node.nodeId, {
      nodeId: node.nodeId,
      canonicalOccurrenceId: node.canonicalOccurrenceId,
      deltas: node.deltas,
      props: { ...node.props },
      meta: await engine.getEntityMetaRecord(node.occurrenceId),
    });
    const children = await engine.getOccurrenceChildren(node.occurrenceId);
    occurrences.set(node.occurrenceId, {
      occurrenceId: node.occurrenceId,
      occId: node.occId,
      nodeId: node.nodeId,
      parentOccurrenceId: node.parentOccurrenceId,
      physicalChildOccurrenceIds: children.map((child) => child.occurrenceId),
      occurrenceProps: { ...node.occurrenceProps },
      occurrenceMeta: engine.getOccurrenceMetaRecord(node.occurrenceId),
    });
    for (const child of children) {
      if (!occurrences.has(child.occurrenceId)) {
        await visit(child);
      }
    }
  };

  for (const root of roots) {
    await visit(root);
  }

  return {
    version: 4,
    entities: [...entities.values()],
    occurrences: [...occurrences.values()],
    rootOccurrenceIds: roots.map((node) => node.occurrenceId),
  };
}

/**
 * treeDoc-only occurrence snapshot — the structural half of `toJSON` with ZERO shard reads.
 * Occurrence props/meta/structure all live on the tree node's `data` container; entities (deltas/
 * props/entityMeta/canonical — the shard-resident fields) are deliberately absent. Used by
 * `ActionHistory`'s incremental capture so undo snapshotting never faults untouched shards. Walks
 * the same reachability as `toJSON` (roots → physical children) but via `getOccurrenceStruct`.
 */
export function toJSONOccurrences(
  engine: Engine,
  rootOccurrenceId?: OccurrenceId,
): { occurrences: NodeOccurrenceSnapshot[]; rootOccurrenceIds: OccurrenceId[] } {
  const roots = rootOccurrenceId != null ? [rootOccurrenceId] : engine.getRootOccurrenceIds();
  const occurrences = new Map<string, NodeOccurrenceSnapshot>();
  const visit = (occurrenceId: OccurrenceId): void => {
    if (occurrences.has(occurrenceId)) {
      return;
    }
    const snap = engine.getOccurrenceStruct(occurrenceId);
    if (!snap) {
      return;
    }
    occurrences.set(occurrenceId, snap);
    for (const child of snap.physicalChildOccurrenceIds) {
      visit(child);
    }
  };
  for (const root of roots) {
    visit(root);
  }
  return { occurrences: [...occurrences.values()], rootOccurrenceIds: roots };
}

export async function fromJSON(
  engine: Engine,
  snapshot: DocSnapshot,
  parentOccurrenceId?: OccurrenceId | null,
): Promise<OccurrenceId[]> {
  const entityById = new Map(snapshot.entities.map((entity) => [entity.nodeId, entity]));
  const occurrenceById = new Map(
    snapshot.occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]),
  );
  const newNodeByOldNode = new Map<string, string>();
  const createdRoots: OccurrenceId[] = [];

  await engine.batch(async () => {
    const importOccurrence = async (
      oldOccurrenceId: string,
      newParentOccurrenceId?: OccurrenceId | null,
    ): Promise<NodeOccurrence> => {
      const occurrence = occurrenceById.get(oldOccurrenceId);
      if (!occurrence) {
        throw new NotFoundError("occurrence", oldOccurrenceId);
      }
      const existingNodeId = newNodeByOldNode.get(occurrence.nodeId);
      let created: NodeOccurrence;
      if (existingNodeId) {
        created = await engine.createOccurrence(existingNodeId, newParentOccurrenceId ?? null);
      } else {
        const entity = entityById.get(occurrence.nodeId);
        if (!entity) {
          throw new NotFoundError("entity", occurrence.nodeId);
        }
        created = await engine.createNode(newParentOccurrenceId ?? null, undefined, entity.props);
        await engine.replaceDeltas(created.occurrenceId, entity.deltas);
        for (const [key, value] of Object.entries(entity.meta)) {
          await engine.setEntityMeta(created.occurrenceId, key, value);
        }
        newNodeByOldNode.set(occurrence.nodeId, created.nodeId);
      }
      for (const [key, value] of Object.entries(occurrence.occurrenceProps)) {
        await engine.setOccurrenceProp(created.occurrenceId, key, value);
      }
      for (const [key, value] of Object.entries(occurrence.occurrenceMeta)) {
        await engine.setOccurrenceMeta(created.occurrenceId, key, value);
      }
      for (const childId of occurrence.physicalChildOccurrenceIds) {
        await importOccurrence(childId, created.occurrenceId);
      }
      return created;
    };

    for (const rootId of snapshot.rootOccurrenceIds) {
      const created = await importOccurrence(rootId, parentOccurrenceId ?? null);
      createdRoots.push(created.occurrenceId);
    }
  });

  return createdRoots;
}
