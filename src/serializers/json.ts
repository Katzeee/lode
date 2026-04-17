import type { BlockEngine } from "../engine.js";
import type { BlockId, BlockSnapshot, DocSnapshot } from "../types.js";

export function toJSON(engine: BlockEngine, rootId?: BlockId): DocSnapshot {
  const build = (id: BlockId): BlockSnapshot => {
    const view = engine.getBlock(id);
    if (!view) throw new Error(`Block not found: ${id}`);
    return {
      id: view.id,
      deltas: view.deltas,
      props: view.props,
      children: view.childIds.map(build),
    };
  };
  const rootIds = rootId != null ? [rootId] : engine.getRootIds();
  return { version: 2, blocks: rootIds.map(build) };
}

export function fromJSON(
  engine: BlockEngine,
  snapshot: DocSnapshot,
  parentId?: BlockId,
): BlockId[] {
  const createdTops: BlockId[] = [];
  engine.batch(() => {
    const createRec = (snap: BlockSnapshot, parent?: BlockId): BlockId => {
      const id = engine.createBlock(parent);
      if (snap.deltas.length > 0) engine.replaceDeltas(id, snap.deltas);
      for (const [k, v] of Object.entries(snap.props)) engine.setProp(id, k, v);
      for (const child of snap.children) createRec(child, id);
      return id;
    };
    for (const block of snapshot.blocks) {
      createdTops.push(createRec(block, parentId));
    }
  });
  return createdTops;
}
