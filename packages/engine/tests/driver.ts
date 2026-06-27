/* eslint-disable max-lines -- applyOp + the weighted TABLE cover the full 18-op surface; length is inherent to completeness. */
import type { Engine } from "../src/core/engine.js";
import type { Delta } from "../src/core/types.js";
import { TruthModel, MARK_KEY, MARK_VALUE, type Op } from "./truth-model.js";

export type { Op };

/**
 * Fuzzer utilities — produces random but ALWAYS-VALID op scripts (index-based, so the
 * same script runs on engines that mint different opaque node/occurrence ids), and
 * applies a single op to an Engine.
 *
 * Op validity (which occurrence/node is live, leaf, non-canonical, non-cycle, has the
 * text/props/marks the op needs) is decided from the TruthModel's queries; `step()`
 * then advances the same model so it stays the independent oracle for the correctness
 * test. `generateScript` is a weighted table over the FULL mutator surface, so every
 * public Engine mutator gets independent coverage.
 */

const SAMPLE_TEXTS = ["", "hi", "hello world", "节点内容", "abc def"];
const PROP_KEYS = ["kind", "tag", "order", "done"];
const META_KEYS = ["src", "ver", "nid"];
const VALUES: unknown[] = ["page", "todo", 1, true, "x"];

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

const textToDelta = (s: string): Delta => [{ insert: s }];

/** Apply ONE op to an engine, resolving occurrence/node indices via the id arrays
 *  (mutated in place). Mirrors the restrictions the generator guarantees. */
export function applyOp(e: Engine, op: Op, occIds: string[], nodeIds: string[]): void {
  const resolveOcc = (idx: number | null): string | null =>
    idx == null ? null : (occIds[idx] ?? null);
  const occ = (i: number): string | undefined => occIds[i];
  switch (op.t) {
    case "createNode": {
      const o = e.createNode(resolveOcc(op.parent), op.index, op.props);
      occIds.push(o.occurrenceId);
      nodeIds.push(o.nodeId);
      break;
    }
    case "createOccurrence": {
      const target = nodeIds[op.target];
      if (target === undefined) {
        break;
      }
      const o = e.createOccurrence(target, resolveOcc(op.parent), op.index);
      occIds.push(o.occurrenceId);
      break;
    }
    case "move": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.moveOccurrence(o, resolveOcc(op.parent), op.index);
      }
      break;
    }
    case "remove": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.removeOccurrence(o);
      }
      break;
    }
    case "deleteNode": {
      const n = nodeIds[op.node];
      if (n !== undefined) {
        e.deleteNode(n);
      }
      break;
    }
    case "setCanonicalOccurrence": {
      const n = nodeIds[op.node];
      const o = occ(op.occ);
      if (n !== undefined && o !== undefined) {
        e.setCanonicalOccurrence(n, o);
      }
      break;
    }
    case "replaceDeltas": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.replaceDeltas(o, textToDelta(op.text));
      }
      break;
    }
    case "mark": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.mark(o, { start: op.start, end: op.end }, MARK_KEY, MARK_VALUE);
      }
      break;
    }
    case "unmark": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.unmark(o, { start: op.start, end: op.end }, MARK_KEY);
      }
      break;
    }
    case "setProp": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.setProp(o, op.key, op.val);
      }
      break;
    }
    case "unsetProp": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.unsetProp(o, op.key);
      }
      break;
    }
    case "setProps": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.setProps(o, op.props);
      }
      break;
    }
    case "setEntityMeta": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.setEntityMeta(o, op.key, op.val);
      }
      break;
    }
    case "unsetEntityMeta": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.unsetEntityMeta(o, op.key);
      }
      break;
    }
    case "setOccurrenceProp": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.setOccurrenceProp(o, op.key, op.val);
      }
      break;
    }
    case "unsetOccurrenceProp": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.unsetOccurrenceProp(o, op.key);
      }
      break;
    }
    case "setOccurrenceMeta": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.setOccurrenceMeta(o, op.key, op.val);
      }
      break;
    }
    case "unsetOccurrenceMeta": {
      const o = occ(op.occ);
      if (o !== undefined) {
        e.unsetOccurrenceMeta(o, op.key);
      }
      break;
    }
  }
}

const pick = <T>(rng: () => number, arr: readonly T[]): T => {
  const v = arr[Math.floor(rng() * arr.length)];
  if (v === undefined) {
    throw new Error("pick from empty");
  }
  return v;
};

/** Pick a parent occurrence (or null ≈20% / when none eligible). For `move`, pass the
 *  moving occ so its own subtree (cycle-forming parents) is excluded. */
const pickParent = (
  rng: () => number,
  m: TruthModel,
  excludeOcc: number | null = null,
): number | null => {
  const idxs = m
    .liveOccs()
    .filter((o) => excludeOcc === null || (o !== excludeOcc && !m.isAncestor(excludeOcc, o)));
  if (idxs.length === 0 || rng() < 0.2) {
    return null;
  }
  return idxs[Math.floor(rng() * idxs.length)] ?? null;
};

type Entry = {
  w: number;
  u?: boolean; // true → undoable on sharded (ActionHistory records an inverse)
  ok: (m: TruthModel) => boolean;
  emit: (m: TruthModel, rng: () => number) => Op | null;
};

const TABLE: Entry[] = [
  {
    w: 5,
    u: true,
    ok: () => true,
    emit: (m, rng) => ({
      t: "createNode",
      parent: pickParent(rng, m),
      props: rng() < 0.5 ? { kind: "page" } : undefined,
    }),
  },
  {
    w: 3,
    u: true,
    ok: (m) => m.liveNodes().length > 0,
    emit: (m, rng) => ({
      t: "createOccurrence",
      target: pick(rng, m.liveNodes()),
      parent: pickParent(rng, m),
    }),
  },
  {
    w: 5,
    u: true,
    ok: (m) => m.liveOccs().length > 0,
    emit: (m, rng) => {
      const occ = pick(rng, m.liveOccs());
      return { t: "move", occ, parent: pickParent(rng, m, occ) };
    },
  },
  {
    w: 2,
    ok: (m) =>
      m.liveOccs().some((o) => m.canonicalOccOf(m.nodeOf(o)) !== o && m.childrenOf(o).length === 0),
    emit: (m, rng) => {
      const removable = m
        .liveOccs()
        .filter((o) => m.canonicalOccOf(m.nodeOf(o)) !== o && m.childrenOf(o).length === 0);
      return removable.length === 0 ? null : { t: "remove", occ: pick(rng, removable) };
    },
  },
  {
    w: 2,
    u: true,
    ok: (m) => m.liveNodes().some((n) => m.occsOf(n).every((o) => m.childrenOf(o).length === 0)),
    emit: (m, rng) => {
      const deletable = m
        .liveNodes()
        .filter((n) => m.occsOf(n).every((o) => m.childrenOf(o).length === 0));
      return deletable.length === 0 ? null : { t: "deleteNode", node: pick(rng, deletable) };
    },
  },
  {
    w: 2,
    u: true,
    ok: (m) => m.liveNodes().some((n) => m.occCount(n) > 1),
    emit: (m, rng) => {
      const multi = m.liveNodes().filter((n) => m.occCount(n) > 1);
      if (multi.length === 0) {
        return null;
      }
      const node = pick(rng, multi);
      const nonCanon = m.occsOf(node).filter((o) => o !== m.canonicalOccOf(node));
      return nonCanon.length === 0
        ? null
        : { t: "setCanonicalOccurrence", node, occ: pick(rng, nonCanon) };
    },
  },
  {
    w: 3,
    u: true,
    ok: (m) => m.liveOccs().length > 0,
    emit: (m, rng) => ({
      t: "replaceDeltas",
      occ: pick(rng, m.liveOccs()),
      text: pick(rng, SAMPLE_TEXTS),
    }),
  },
  {
    w: 3,
    u: true,
    ok: (m) => m.liveOccs().some((o) => m.textLenOf(m.nodeOf(o)) > 0),
    emit: (m, rng) => {
      const cands = m.liveOccs().filter((o) => m.textLenOf(m.nodeOf(o)) > 0);
      if (cands.length === 0) {
        return null;
      }
      const occ = pick(rng, cands);
      const len = m.textLenOf(m.nodeOf(occ));
      const start = Math.floor(rng() * len);
      const end = Math.min(len, start + 1 + Math.floor(rng() * (len - start)));
      return { t: "mark", occ, start, end };
    },
  },
  {
    w: 2,
    u: true,
    ok: (m) => m.liveOccs().some((o) => m.markIntervals(m.nodeOf(o)).length > 0),
    emit: (m, rng) => {
      const cands = m.liveOccs().filter((o) => m.markIntervals(m.nodeOf(o)).length > 0);
      if (cands.length === 0) {
        return null;
      }
      const occ = pick(rng, cands);
      const intervals = m.markIntervals(m.nodeOf(occ));
      const [s, e] = pick(rng, intervals);
      const start = e - s <= 1 ? s : s + Math.floor(rng() * (e - s));
      const end = Math.min(e, start + 1 + Math.floor(rng() * (e - start)));
      return { t: "unmark", occ, start, end };
    },
  },
  {
    w: 2,
    u: true,
    ok: (m) => m.liveOccs().length > 0,
    emit: (m, rng) => ({
      t: "setProp",
      occ: pick(rng, m.liveOccs()),
      key: pick(rng, PROP_KEYS),
      val: pick(rng, VALUES),
    }),
  },
  {
    w: 1,
    ok: (m) => m.liveOccs().some((o) => m.nodePropKeys(m.nodeOf(o)).length > 0),
    emit: (m, rng) => {
      const cands = m.liveOccs().filter((o) => m.nodePropKeys(m.nodeOf(o)).length > 0);
      if (cands.length === 0) {
        return null;
      }
      const occ = pick(rng, cands);
      return { t: "unsetProp", occ, key: pick(rng, m.nodePropKeys(m.nodeOf(occ))) };
    },
  },
  {
    w: 1,
    ok: (m) => m.liveOccs().length > 0,
    emit: (m, rng) => ({
      t: "setProps",
      occ: pick(rng, m.liveOccs()),
      props: { [pick(rng, PROP_KEYS)]: pick(rng, VALUES) },
    }),
  },
  {
    w: 2,
    ok: (m) => m.liveOccs().length > 0,
    emit: (m, rng) => ({
      t: "setEntityMeta",
      occ: pick(rng, m.liveOccs()),
      key: pick(rng, META_KEYS),
      val: pick(rng, VALUES),
    }),
  },
  {
    w: 1,
    ok: (m) => m.liveOccs().some((o) => m.nodeEntityMetaKeys(m.nodeOf(o)).length > 0),
    emit: (m, rng) => {
      const cands = m.liveOccs().filter((o) => m.nodeEntityMetaKeys(m.nodeOf(o)).length > 0);
      if (cands.length === 0) {
        return null;
      }
      const occ = pick(rng, cands);
      return { t: "unsetEntityMeta", occ, key: pick(rng, m.nodeEntityMetaKeys(m.nodeOf(occ))) };
    },
  },
  {
    w: 2,
    ok: (m) => m.liveOccs().length > 0,
    emit: (m, rng) => ({
      t: "setOccurrenceProp",
      occ: pick(rng, m.liveOccs()),
      key: pick(rng, PROP_KEYS),
      val: pick(rng, VALUES),
    }),
  },
  {
    w: 1,
    ok: (m) => m.liveOccs().some((o) => m.occPropKeys(o).length > 0),
    emit: (m, rng) => {
      const cands = m.liveOccs().filter((o) => m.occPropKeys(o).length > 0);
      if (cands.length === 0) {
        return null;
      }
      const occ = pick(rng, cands);
      return { t: "unsetOccurrenceProp", occ, key: pick(rng, m.occPropKeys(occ)) };
    },
  },
  {
    w: 2,
    ok: (m) => m.liveOccs().length > 0,
    emit: (m, rng) => ({
      t: "setOccurrenceMeta",
      occ: pick(rng, m.liveOccs()),
      key: pick(rng, META_KEYS),
      val: pick(rng, VALUES),
    }),
  },
  {
    w: 1,
    ok: (m) => m.liveOccs().some((o) => m.occMetaKeys(o).length > 0),
    emit: (m, rng) => {
      const cands = m.liveOccs().filter((o) => m.occMetaKeys(o).length > 0);
      if (cands.length === 0) {
        return null;
      }
      const occ = pick(rng, cands);
      return { t: "unsetOccurrenceMeta", occ, key: pick(rng, m.occMetaKeys(occ)) };
    },
  },
];

/** Generate a random but always-valid script. Weighted over the full mutator surface;
 *  the TruthModel decides validity and is advanced in lockstep, so the script replays
 *  against a fresh model. */
/** Generate a random but always-valid script. Weighted over the full mutator surface;
 *  the TruthModel decides validity and is advanced in lockstep, so the script replays
 *  against a fresh model. `undoableOnly` restricts to the 9 mutators ActionHistory
 *  records an inverse for (for the undo/redo round-trip property). */
export function generateScript(rng: () => number, length: number, undoableOnly = false): Op[] {
  const m = new TruthModel();
  const ops: Op[] = [];
  for (let i = 0; i < length; i++) {
    const eligible = TABLE.filter((e) => e.ok(m) && (!undoableOnly || e.u));
    const total = eligible.reduce((sum, e) => sum + e.w, 0);
    let r = rng() * total;
    let chosen: Entry | undefined;
    for (const e of eligible) {
      r -= e.w;
      if (r <= 0) {
        chosen = e;
        break;
      }
    }
    chosen = chosen ?? eligible.at(-1);
    if (!chosen) {
      continue;
    }
    const op = chosen.emit(m, rng);
    if (op === null) {
      continue;
    }
    ops.push(op);
    m.step(op);
  }
  return ops;
}
