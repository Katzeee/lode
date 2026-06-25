import type { Engine } from "../engine.js";
import type {
  DocSnapshot,
  NodeEntitySnapshot,
  NodeOccurrence,
  NodeOccurrenceSnapshot,
  OccurrenceId,
} from "../types.js";

export function toJSON(engine: Engine, rootOccurrenceId?: OccurrenceId): DocSnapshot {
  const roots =
    rootOccurrenceId != null
      ? [engine.getOccurrence(rootOccurrenceId)].filter(
          (node): node is NodeOccurrence => node != null,
        )
      : engine.getRootOccurrences();
  const entities = new Map<string, NodeEntitySnapshot>();
  const occurrences = new Map<string, NodeOccurrenceSnapshot>();

  const visit = (node: NodeOccurrence): void => {
    entities.set(node.nodeId, {
      nodeId: node.nodeId,
      canonicalOccurrenceId: node.canonicalOccurrenceId,
      deltas: node.deltas,
      props: { ...node.props },
      meta: engine.getEntityMetaRecord(node.occurrenceId),
    });
    occurrences.set(node.occurrenceId, {
      occurrenceId: node.occurrenceId,
      nodeId: node.nodeId,
      parentOccurrenceId: node.parentOccurrenceId,
      physicalChildOccurrenceIds: engine
        .getOccurrenceChildren(node.occurrenceId)
        .map((child) => child.occurrenceId),
      occurrenceProps: { ...node.occurrenceProps },
      occurrenceMeta: engine.getOccurrenceMetaRecord(node.occurrenceId),
    });
    for (const child of engine.getOccurrenceChildren(node.occurrenceId)) {
      if (!occurrences.has(child.occurrenceId)) {
        visit(child);
      }
    }
  };

  for (const root of roots) {
    visit(root);
  }

  return {
    version: 4,
    entities: [...entities.values()],
    occurrences: [...occurrences.values()],
    rootOccurrenceIds: roots.map((node) => node.occurrenceId),
  };
}

export function fromJSON(
  engine: Engine,
  snapshot: DocSnapshot,
  parentOccurrenceId?: OccurrenceId | null,
): OccurrenceId[] {
  const entityById = new Map(snapshot.entities.map((entity) => [entity.nodeId, entity]));
  const occurrenceById = new Map(
    snapshot.occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]),
  );
  const newNodeByOldNode = new Map<string, string>();
  const createdRoots: OccurrenceId[] = [];

  engine.batch(() => {
    const importOccurrence = (
      oldOccurrenceId: string,
      newParentOccurrenceId?: OccurrenceId | null,
    ): NodeOccurrence => {
      const occurrence = occurrenceById.get(oldOccurrenceId);
      if (!occurrence) {
        throw new Error(`Occurrence snapshot not found: ${oldOccurrenceId}`);
      }
      const existingNodeId = newNodeByOldNode.get(occurrence.nodeId);
      let created: NodeOccurrence;
      if (existingNodeId) {
        created = engine.createOccurrence(existingNodeId, newParentOccurrenceId ?? null);
      } else {
        const entity = entityById.get(occurrence.nodeId);
        if (!entity) {
          throw new Error(`Entity snapshot not found: ${occurrence.nodeId}`);
        }
        created = engine.createNode(newParentOccurrenceId ?? null, undefined, entity.props);
        engine.replaceDeltas(created.occurrenceId, entity.deltas);
        for (const [key, value] of Object.entries(entity.meta)) {
          engine.setEntityMeta(created.occurrenceId, key, value);
        }
        newNodeByOldNode.set(occurrence.nodeId, created.nodeId);
      }
      for (const [key, value] of Object.entries(occurrence.occurrenceProps)) {
        engine.setOccurrenceProp(created.occurrenceId, key, value);
      }
      for (const [key, value] of Object.entries(occurrence.occurrenceMeta)) {
        engine.setOccurrenceMeta(created.occurrenceId, key, value);
      }
      for (const childId of occurrence.physicalChildOccurrenceIds) {
        importOccurrence(childId, created.occurrenceId);
      }
      return created;
    };

    for (const rootId of snapshot.rootOccurrenceIds) {
      const created = importOccurrence(rootId, parentOccurrenceId ?? null);
      createdRoots.push(created.occurrenceId);
    }
  });

  return createdRoots;
}
