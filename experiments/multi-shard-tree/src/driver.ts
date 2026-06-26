import type { NodeId, OccurrenceId, OutlineApi } from "./types.js";

/**
 * An operation script. Occurrence references are expressed as INDICES into the
 * sequence of occurrence ids returned by createNode/createReference — not as the
 * ids themselves. This lets the identical script run on two engines that mint
 * different opaque TreeIDs, which is the basis of differential testing.
 */
export type Op =
  | { t: "createNode"; nodeId: NodeId; parent: number | null; index?: number; text?: string }
  | { t: "createReference"; target: NodeId; parent: number | null; index?: number }
  | { t: "move"; occ: number; parent: number | null; index?: number }
  | { t: "remove"; occ: number }
  | { t: "hardDelete"; nodeId: NodeId }
  | { t: "setText"; nodeId: NodeId; text: string }
  | { t: "setProp"; nodeId: NodeId; key: string; value: unknown }
  | { t: "setOccurrenceMeta"; occ: number; key: string; value: unknown }
  | { t: "markText"; nodeId: NodeId; start: number; end: number; key: string }
  | { t: "insertText"; nodeId: NodeId; pos: number; str: string };

/** Apply a script to an engine, resolving occurrence indices to that engine's own ids. */
export function applyScript(e: OutlineApi, ops: Op[]): OccurrenceId[] {
  const occIds: OccurrenceId[] = [];
  const resolve = (idx: number | null): OccurrenceId | null => (idx == null ? null : occIds[idx]!);
  for (const op of ops) {
    switch (op.t) {
      case "createNode": {
        const id = e.createNode(op.nodeId, resolve(op.parent), op.index, op.text);
        occIds.push(id);
        break;
      }
      case "createReference": {
        const id = e.createReference(op.target, resolve(op.parent), op.index);
        occIds.push(id);
        break;
      }
      case "move":
        e.moveOccurrence(resolve(op.occ), resolve(op.parent), op.index);
        break;
      case "remove":
        e.removeOccurrence(resolve(op.occ));
        break;
      case "hardDelete":
        e.hardDeleteNode(op.nodeId);
        break;
      case "setText":
        e.setText(op.nodeId, op.text);
        break;
      case "setProp":
        e.setEntityProp(op.nodeId, op.key, op.value);
        break;
      case "setOccurrenceMeta":
        e.setOccurrenceMeta(resolve(op.occ), op.key, op.value);
        break;
      case "markText":
        e.markText(op.nodeId, op.start, op.end, op.key, true);
        break;
      case "insertText":
        e.insertText(op.nodeId, op.pos, op.str);
        break;
    }
  }
  e.commit();
  return occIds;
}

/** Deterministic seeded RNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_TEXTS = ["", "hi", "hello world", "节点内容", "abc def"];
const PROP_KEYS = ["kind", "tag", "order", "done"];
const PROP_VALUES: unknown[] = ["page", "todo", 1, true, "x"];

/**
 * Generate a random but ALWAYS-VALID script, tracked by a lightweight model so
 * every referenced occurrence/node is live and no move creates a cycle. The
 * model mirrors engine semantics, so the script is valid for any OutlineApi.
 *
 * (Removes are restricted to leaf, non-canonical occurrences so the model stays
 * simple; full hard-delete cascades are covered by the explicit scenarios and
 * the oracle's own suite.)
 */
export function generateScript(rng: () => number, length: number, idPrefix = "n"): Op[] {
  const ops: Op[] = [];
  const live = new Map<number, { nodeId: NodeId; parent: number | null }>();
  const canonicalOf = new Map<NodeId, number>();
  const liveNodes = new Set<NodeId>();
  const textLen = new Map<NodeId, number>(); // tracks JS-string length, for mark/insert bounds
  let nodeCounter = 0;
  let occCounter = 0;

  const liveIndices = (): number[] => [...live.keys()];
  const liveNodeList = (): NodeId[] => [...liveNodes];
  const pickLiveOrRoot = (): number | null => {
    const idxs = liveIndices();
    if (idxs.length === 0 || rng() < 0.2) return null;
    return idxs[Math.floor(rng() * idxs.length)] ?? null;
  };
  const isAncestor = (maybeAnc: number, idx: number): boolean => {
    let cur: number | null = idx;
    while (cur !== null) {
      if (cur === maybeAnc) return true;
      cur = live.get(cur)?.parent ?? null;
    }
    return false;
  };
  const childrenOf = (idx: number): number[] =>
    liveIndices().filter((i) => live.get(i)?.parent === idx);

  // Faithful iterative model of the engine's cascade, so the generated script
  // never references an occurrence/node the engine has already removed. Iterative
  // (like the engine's cascadeRemove) so self-nesting cannot loop.
  const occIdxsOf = (nodeId: NodeId): number[] =>
    [...live.entries()].filter(([, v]) => v.nodeId === nodeId).map(([i]) => i);
  const modelCascade = (seedIdxs: number[]): void => {
    const removed = new Set<number>();
    const work = [...seedIdxs];
    while (work.length > 0) {
      const o = work.pop()!;
      if (removed.has(o) || !live.has(o)) continue;
      removed.add(o);
      const nid = live.get(o)!.nodeId;
      for (const c of childrenOf(o)) work.push(c);
      if (o === canonicalOf.get(nid)) for (const occ of occIdxsOf(nid)) work.push(occ);
    }
    const deletedNodes = new Set<NodeId>();
    for (const nid of liveNodes) if (removed.has(canonicalOf.get(nid)!)) deletedNodes.add(nid);
    for (const i of removed) live.delete(i);
    for (const n of deletedNodes) {
      liveNodes.delete(n);
      canonicalOf.delete(n);
      textLen.delete(n);
    }
  };
  const modelRemove = (idx: number): void => {
    if (!live.has(idx)) return;
    const nodeId = live.get(idx)!.nodeId;
    if (idx === canonicalOf.get(nodeId)) {
      modelCascade(occIdxsOf(nodeId));
      return;
    }
    modelCascade([idx]);
  };
  const modelHardDelete = (nodeId: NodeId): void => {
    if (!liveNodes.has(nodeId)) return;
    modelCascade(occIdxsOf(nodeId));
  };

  for (let i = 0; i < length; i++) {
    const roll = rng();
    // Bias toward creating early so there's something to operate on.
    if (roll < 0.34 || live.size === 0) {
      const nodeId = `${idPrefix}${nodeCounter++}`;
      const text = rng() < 0.5 ? SAMPLE_TEXTS[Math.floor(rng() * SAMPLE_TEXTS.length)]! : undefined;
      ops.push({ t: "createNode", nodeId, parent: pickLiveOrRoot(), text });
      live.set(occCounter, { nodeId, parent: ops[ops.length - 1]!.parent ?? null });
      canonicalOf.set(nodeId, occCounter);
      liveNodes.add(nodeId);
      if (text) textLen.set(nodeId, text.length);
      occCounter++;
    } else if (roll < 0.5) {
      const target = liveNodeList()[Math.floor(rng() * liveNodeList().length)]!;
      const parent = pickLiveOrRoot();
      ops.push({ t: "createReference", target, parent });
      live.set(occCounter, { nodeId: target, parent });
      occCounter++;
    } else if (roll < 0.7) {
      const idxs = liveIndices();
      const occ = idxs[Math.floor(rng() * idxs.length)]!;
      const parent = pickLiveOrRoot();
      if (parent !== null && (parent === occ || isAncestor(occ, parent))) continue; // no cycle
      ops.push({ t: "move", occ, parent });
      live.get(occ)!.parent = parent;
    } else if (roll < 0.8) {
      // Remove any non-canonical live occurrence; modelRemove mirrors the
      // engine's subtree cascade so subsequent ops stay valid.
      const removable = liveIndices().filter((i) => canonicalOf.get(live.get(i)!.nodeId) !== i);
      if (removable.length === 0) continue;
      const occ = removable[Math.floor(rng() * removable.length)]!;
      ops.push({ t: "remove", occ });
      modelRemove(occ);
    } else if (roll < 0.86) {
      const nodes = liveNodeList();
      if (nodes.length === 0) continue;
      const nodeId = nodes[Math.floor(rng() * nodes.length)]!;
      ops.push({ t: "hardDelete", nodeId });
      modelHardDelete(nodeId);
    } else if (roll < 0.91) {
      const nodes = liveNodeList();
      if (nodes.length === 0) continue;
      const nodeId = nodes[Math.floor(rng() * nodes.length)]!;
      const text = SAMPLE_TEXTS[Math.floor(rng() * SAMPLE_TEXTS.length)]!;
      ops.push({ t: "setText", nodeId, text });
      textLen.set(nodeId, text.length);
    } else if (roll < 0.94) {
      const nodes = liveNodeList();
      if (nodes.length === 0) continue;
      const nodeId = nodes[Math.floor(rng() * nodes.length)]!;
      ops.push({
        t: "setProp",
        nodeId,
        key: PROP_KEYS[Math.floor(rng() * PROP_KEYS.length)]!,
        value: PROP_VALUES[Math.floor(rng() * PROP_VALUES.length)]!,
      });
    } else if (roll < 0.97) {
      // mark a small range on a node that has content (exercises rich-text marks)
      const withText = liveNodeList().filter((n) => (textLen.get(n) ?? 0) > 0);
      if (withText.length === 0) continue;
      const nodeId = withText[Math.floor(rng() * withText.length)]!;
      const len = textLen.get(nodeId)!;
      const start = Math.floor(rng() * len);
      const end = Math.min(len, start + 1 + Math.floor(rng() * Math.max(1, len - start)));
      ops.push({ t: "markText", nodeId, start, end, key: "bold" });
    } else if (roll < 0.99) {
      const nodes = liveNodeList();
      if (nodes.length === 0) continue;
      const nodeId = nodes[Math.floor(rng() * nodes.length)]!;
      const len = textLen.get(nodeId) ?? 0;
      const pos = Math.floor(rng() * (len + 1));
      const str = rng() < 0.5 ? "!" : "more";
      ops.push({ t: "insertText", nodeId, pos, str });
      textLen.set(nodeId, len + str.length);
    } else {
      // per-occurrence meta (managed-child provenance shape) on a live occurrence
      const idxs = liveIndices();
      if (idxs.length === 0) continue;
      const occ = idxs[Math.floor(rng() * idxs.length)]!;
      ops.push({
        t: "setOccurrenceMeta",
        occ,
        key: "managedChild",
        value: {
          managedKind: "fieldSlot",
          managedBySchemas: [{ schemaId: "S", schemaChildOccurrenceId: `occ-${occ}` }],
        },
      });
    }
  }
  return ops;
}
