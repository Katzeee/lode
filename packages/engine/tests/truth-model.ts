/* eslint-disable max-lines -- One cohesive oracle; its length reflects the complete 18-op surface (splitting would scatter the spec). */
/**
 * TruthModel — an INDEPENDENT oracle for the engine's observable behavior, derived
 * from the prose semantics (not from any store implementation). The fuzzer drives an
 * Engine and this model with the SAME op script; after each op the engine's
 * serialized snapshot must equal the model's projection. This is correctness testing:
 * a shared-layer bug (Engine mutator / Domain / Loro) that a cross-store differential
 * cannot see is caught here, because the model is the independent truth.
 *
 * `generateScript` (driver.ts) uses the query methods to pick always-valid ops and
 * `step()` to advance the model in lockstep; the correctness test replays a fixed op
 * list through `step()` and compares `project()` against the engine snapshot.
 *
 * nodeId ↔ nodeIdx alignment: the test pairs the engine with a `counterGen()`
 * (`"n0","n1",…`) that advances only on `createNode`; the model mints `nodeIdx` only on
 * `createNode`. So `nodeIdx === Number(nodeId.slice(1))`. Occurrence ids are opaque
 * and normalized out by projecting both sides to DFS-position space.
 *
 * Op surface: the full public Engine mutator set (createNode, createOccurrence, move,
 * remove, deleteNode, setCanonicalOccurrence, replaceDeltas, mark, unmark, setProp,
 * unsetProp, setProps, setEntityMeta, unsetEntityMeta, setOccurrenceProp,
 * unsetOccurrenceProp, setOccurrenceMeta, unsetOccurrenceMeta). Every mutator has an
 * independent witness — no public mutator lacks one.
 */

export type Op =
  | { t: "createNode"; parent: number | null; index?: number; props?: Record<string, unknown> }
  | { t: "createOccurrence"; target: number; parent: number | null; index?: number }
  | { t: "move"; occ: number; parent: number | null; index?: number }
  | { t: "remove"; occ: number }
  | { t: "deleteNode"; node: number }
  | { t: "setCanonicalOccurrence"; node: number; occ: number }
  | { t: "replaceDeltas"; occ: number; text: string }
  | { t: "mark"; occ: number; start: number; end: number }
  | { t: "unmark"; occ: number; start: number; end: number }
  | { t: "setProp"; occ: number; key: string; val: unknown }
  | { t: "unsetProp"; occ: number; key: string }
  | { t: "setProps"; occ: number; props: Record<string, unknown> }
  | { t: "setEntityMeta"; occ: number; key: string; val: unknown }
  | { t: "unsetEntityMeta"; occ: number; key: string }
  | { t: "setOccurrenceProp"; occ: number; key: string; val: unknown }
  | { t: "unsetOccurrenceProp"; occ: number; key: string }
  | { t: "setOccurrenceMeta"; occ: number; key: string; val: unknown }
  | { t: "unsetOccurrenceMeta"; occ: number; key: string };

/** The single mark the fuzzer applies (kept here so driver + model cannot drift). */
export const MARK_KEY = "bold";
export const MARK_VALUE = true;

/** Deterministic, key-sorted JSON string — the canonical form both sides project to. */
export const stableStringify = (value: unknown): string => {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v.map(sort);
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) {
        out[k] = sort((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
};

export type ModelView = {
  /** nodeIdx at each DFS position (a transcluded node repeats). */
  dfs: number[];
  /** stableStringify({props, meta}) of the occurrence at each DFS position. */
  occDataAtDfs: string[];
  nodes: Record<
    number,
    {
      text: string;
      props: string;
      entityMeta: string;
      occurrenceCount: number;
      canonicalDfsIndex: number;
      /** normalized bold [start,end) intervals — range-aware, survives unmark. */
      marks: [number, number][];
    }
  >;
};

export class TruthModel {
  private occNode = new Map<number, number>();
  private occParent = new Map<number, number | null>();
  private nodeCanonical = new Map<number, number>();
  private nodeOccs = new Map<number, Set<number>>();
  // ordered structure (the engine's Tree orders children/roots; append when no index)
  private children = new Map<number, number[]>();
  private roots: number[] = [];
  // values
  private nodeText = new Map<number, string>();
  private nodeProps = new Map<number, Record<string, unknown>>();
  private nodeEntityMeta = new Map<number, Record<string, unknown>>();
  private nodeMarks = new Map<number, [number, number][]>(); // bold intervals
  private occProps = new Map<number, Record<string, unknown>>();
  private occMeta = new Map<number, Record<string, unknown>>();

  // ── queries (used by generateScript to pick always-valid ops) ────────────────

  liveOccs(): number[] {
    return [...this.occNode.keys()];
  }
  liveNodes(): number[] {
    return [...this.nodeCanonical.keys()];
  }
  nodeOf(occ: number): number {
    const n = this.occNode.get(occ);
    if (n === undefined) {
      throw new Error(`occ ${occ} not in model`);
    }
    return n;
  }
  canonicalOccOf(node: number): number {
    const c = this.nodeCanonical.get(node);
    if (c === undefined) {
      throw new Error(`node ${node} not in model`);
    }
    return c;
  }
  occsOf(node: number): number[] {
    return [...(this.nodeOccs.get(node) ?? [])];
  }
  occCount(node: number): number {
    return this.nodeOccs.get(node)?.size ?? 0;
  }
  childrenOf(occ: number): number[] {
    return this.children.get(occ) ?? [];
  }
  parentOf(occ: number): number | null {
    return this.occParent.get(occ) ?? null;
  }
  textLenOf(node: number): number {
    return this.nodeText.get(node)?.length ?? 0;
  }
  isAncestor(maybeAnc: number, occ: number): boolean {
    let cur: number | null = occ;
    while (cur !== null) {
      if (cur === maybeAnc) {
        return true;
      }
      cur = this.occParent.get(cur) ?? null;
    }
    return false;
  }
  nodePropKeys(node: number): string[] {
    return Object.keys(this.nodeProps.get(node) ?? {});
  }
  nodeEntityMetaKeys(node: number): string[] {
    return Object.keys(this.nodeEntityMeta.get(node) ?? {});
  }
  occPropKeys(occ: number): string[] {
    return Object.keys(this.occProps.get(occ) ?? {});
  }
  occMetaKeys(occ: number): string[] {
    return Object.keys(this.occMeta.get(occ) ?? {});
  }
  /** Current bold intervals for a node (normalized) — for picking unmark ranges. */
  markIntervals(node: number): [number, number][] {
    return normalizeIntervals(this.nodeMarks.get(node) ?? []);
  }

  // ── advance (deterministic; mirrors the op the engine received) ──────────────

  step(op: Op): void {
    switch (op.t) {
      case "createNode": {
        const nodeIdx = this.nodeCounter();
        const occIdx = this.occCounter();
        this.recordOcc(occIdx, nodeIdx, op.parent, op.index);
        this.nodeCanonical.set(nodeIdx, occIdx);
        this.nodeOccs.set(nodeIdx, new Set([occIdx]));
        this.nodeText.set(nodeIdx, "");
        this.nodeProps.set(nodeIdx, op.props ? { ...op.props } : {});
        this.nodeEntityMeta.set(nodeIdx, {});
        this.nodeMarks.set(nodeIdx, []);
        this.occProps.set(occIdx, {});
        this.occMeta.set(occIdx, {});
        break;
      }
      case "createOccurrence": {
        const occIdx = this.occCounter();
        this.recordOcc(occIdx, op.target, op.parent, op.index);
        this.nodeOccs.get(op.target)?.add(occIdx);
        this.occProps.set(occIdx, {});
        this.occMeta.set(occIdx, {});
        break;
      }
      case "move": {
        this.detach(op.occ);
        this.occParent.set(op.occ, op.parent);
        this.attach(op.occ, op.parent, op.index);
        break;
      }
      case "remove": {
        const n = this.nodeOf(op.occ);
        this.detach(op.occ);
        this.occNode.delete(op.occ);
        this.occParent.delete(op.occ);
        this.nodeOccs.get(n)?.delete(op.occ);
        this.occProps.delete(op.occ);
        this.occMeta.delete(op.occ);
        break;
      }
      case "deleteNode": {
        const occs = this.occsOf(op.node);
        for (const o of occs) {
          this.detach(o);
          this.occNode.delete(o);
          this.occParent.delete(o);
          this.occProps.delete(o);
          this.occMeta.delete(o);
        }
        this.nodeCanonical.delete(op.node);
        this.nodeOccs.delete(op.node);
        this.nodeText.delete(op.node);
        this.nodeProps.delete(op.node);
        this.nodeEntityMeta.delete(op.node);
        this.nodeMarks.delete(op.node);
        break;
      }
      case "setCanonicalOccurrence": {
        this.nodeCanonical.set(op.node, op.occ);
        break;
      }
      case "replaceDeltas": {
        const n = this.nodeOf(op.occ);
        this.nodeText.set(n, op.text);
        this.nodeMarks.set(n, []); // text is replaced wholesale → marks cleared
        break;
      }
      case "mark": {
        const n = this.nodeOf(op.occ);
        const cur = normalizeIntervals(this.nodeMarks.get(n) ?? []);
        cur.push([op.start, op.end]);
        this.nodeMarks.set(n, normalizeIntervals(cur));
        break;
      }
      case "unmark": {
        const n = this.nodeOf(op.occ);
        const cur = normalizeIntervals(this.nodeMarks.get(n) ?? []);
        this.nodeMarks.set(n, subtractInterval(cur, [op.start, op.end]));
        break;
      }
      case "setProp": {
        const n = this.nodeOf(op.occ);
        (this.nodeProps.get(n) ?? {})[op.key] = op.val;
        break;
      }
      case "unsetProp": {
        const n = this.nodeOf(op.occ);
        delete (this.nodeProps.get(n) ?? {})[op.key];
        break;
      }
      case "setProps": {
        const n = this.nodeOf(op.occ);
        const merged = { ...(this.nodeProps.get(n) ?? {}), ...op.props };
        this.nodeProps.set(n, merged);
        break;
      }
      case "setEntityMeta": {
        const n = this.nodeOf(op.occ);
        (this.nodeEntityMeta.get(n) ?? {})[op.key] = op.val;
        break;
      }
      case "unsetEntityMeta": {
        const n = this.nodeOf(op.occ);
        delete (this.nodeEntityMeta.get(n) ?? {})[op.key];
        break;
      }
      case "setOccurrenceProp": {
        (this.occProps.get(op.occ) ?? {})[op.key] = op.val;
        break;
      }
      case "unsetOccurrenceProp": {
        delete (this.occProps.get(op.occ) ?? {})[op.key];
        break;
      }
      case "setOccurrenceMeta": {
        (this.occMeta.get(op.occ) ?? {})[op.key] = op.val;
        break;
      }
      case "unsetOccurrenceMeta": {
        delete (this.occMeta.get(op.occ) ?? {})[op.key];
        break;
      }
    }
  }

  // ── project to the canonical form comparable to an engine snapshot ───────────

  project(): ModelView {
    const dfs: number[] = [];
    const occDataAtDfs: string[] = [];
    const dfsIndexOfOcc = new Map<number, number>();
    const visit = (occ: number): void => {
      if (dfsIndexOfOcc.has(occ)) {
        return;
      }
      dfsIndexOfOcc.set(occ, dfs.length);
      dfs.push(this.nodeOf(occ));
      occDataAtDfs.push(
        stableStringify({
          props: this.occProps.get(occ) ?? {},
          meta: this.occMeta.get(occ) ?? {},
        }),
      );
      for (const c of this.childrenOf(occ)) {
        visit(c);
      }
    };
    for (const r of this.roots) {
      visit(r);
    }

    const nodes: ModelView["nodes"] = {};
    for (const [nodeIdx, canonOcc] of this.nodeCanonical) {
      nodes[nodeIdx] = {
        text: this.nodeText.get(nodeIdx) ?? "",
        props: stableStringify(this.nodeProps.get(nodeIdx) ?? {}),
        entityMeta: stableStringify(this.nodeEntityMeta.get(nodeIdx) ?? {}),
        occurrenceCount: (this.nodeOccs.get(nodeIdx) ?? new Set()).size,
        canonicalDfsIndex: dfsIndexOfOcc.get(canonOcc) ?? -1,
        marks: normalizeIntervals(this.nodeMarks.get(nodeIdx) ?? []),
      };
    }
    return { dfs, occDataAtDfs, nodes };
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private occSeq = 0;
  private nodeSeq = 0;
  private occCounter(): number {
    return this.occSeq++;
  }
  private nodeCounter(): number {
    return this.nodeSeq++;
  }

  private recordOcc(occ: number, node: number, parent: number | null, index?: number): void {
    this.occNode.set(occ, node);
    this.occParent.set(occ, parent);
    this.attach(occ, parent, index);
  }

  private attach(occ: number, parent: number | null, index?: number): void {
    if (parent === null) {
      this.roots = insertAt(this.roots, occ, index);
    } else {
      this.children.set(parent, insertAt(this.children.get(parent) ?? [], occ, index));
    }
  }

  private detach(occ: number): void {
    const p = this.occParent.get(occ);
    if (p === null || p === undefined) {
      this.roots = this.roots.filter((x) => x !== occ);
    } else {
      this.children.set(
        p,
        (this.children.get(p) ?? []).filter((x) => x !== occ),
      );
    }
  }
}

const insertAt = (arr: number[], occ: number, index?: number): number[] => {
  if (index === undefined || index >= arr.length) {
    return [...arr, occ];
  }
  const at = Math.max(0, index);
  return [...arr.slice(0, at), occ, ...arr.slice(at)];
};

/** Merge overlapping/adjacent [start,end) intervals into a sorted canonical list. */
export const normalizeIntervals = (raw: [number, number][]): [number, number][] => {
  const valid = raw.filter(([s, e]) => s < e);
  if (valid.length === 0) {
    return [];
  }
  const sorted = [...valid].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out.at(-1);
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      out.push([s, e]);
    }
  }
  return out;
};

/** Subtract [s,e) from a normalized interval list. */
const subtractInterval = (
  intervals: [number, number][],
  [s, e]: [number, number],
): [number, number][] => {
  const out: [number, number][] = [];
  for (const [a, b] of intervals) {
    if (b <= s || a >= e) {
      out.push([a, b]);
      continue;
    }
    if (a < s) {
      out.push([a, s]);
    }
    if (b > e) {
      out.push([e, b]);
    }
  }
  return out;
};
