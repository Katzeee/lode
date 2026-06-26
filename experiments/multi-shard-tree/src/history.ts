import type { NodeId, OccurrenceId, OutlineApi, TreeSnapshot } from "./types.js";

/**
 * ENGINE-layer undo/redo mechanism (business-agnostic). Mirrors Anytype's
 * `core/block/undo`: a per-replica action stack where each action is a NET
 * structural change, and undo applies the inverse forward through the engine's
 * own OutlineApi — so cross-doc (treeDoc + shards) writes are transparent.
 *
 * Why this shape (not Loro's per-doc UndoManager): occurrence ids are opaque and
 * churn across delete/recreate, so all descriptors are NODE-stable (parent
 * expressed as a nodeId, resolved to an occurrence at apply time). That makes
 * actions re-applicable across unlimited undo/redo cycles.
 *
 * Granularity is the DOMAIN's job: a domain composite op (e.g. reconcile) wraps
 * its structural mutations in begin/end so the group's net diff is recorded as
 * ONE undo step. The engine knows nothing about schemas/slots.
 *
 * Cascade: hardDelete/removeOccurrence can fan out across treeDoc + many shards.
 * Their inverse is a RESTORE-LIST computed by diffing the engine snapshot
 * before vs after the op (everything that disappeared, in tree order). Undo
 * replays that list, re-creating nodes + occurrences + content.
 */

/** A parent expressed as a nodeId (stable), not an opaque occurrence id. null = root. */
type ParentNode = NodeId | null;

type Desc =
  | {
      t: "createNode";
      nodeId: NodeId;
      parent: ParentNode;
      index: number | undefined;
      text: string | undefined;
    }
  | { t: "createReference"; target: NodeId; parent: ParentNode; index: number | undefined }
  | {
      t: "move";
      nodeId: NodeId;
      fromParent: ParentNode;
      fromIndex: number;
      toParent: ParentNode;
      toIndex: number;
    }
  | { t: "setCanonical"; nodeId: NodeId; occurrenceId: OccurrenceId }
  | { t: "setText"; nodeId: NodeId; text: string }
  | { t: "setProp"; nodeId: NodeId; key: string; value: unknown }
  | { t: "markText"; nodeId: NodeId; start: number; end: number; key: string; value: unknown }
  | { t: "insertText"; nodeId: NodeId; pos: number; str: string }
  | { t: "applyContentDelta"; nodeId: NodeId; delta: unknown[] }
  | { t: "hardDelete"; nodeId: NodeId }
  | { t: "removeOcc"; nodeId: NodeId; parent: ParentNode; index: number };

/** An action = forward steps + inverse steps. Each step is a list of descs
 *  applied together (a cascade's inverse is one multi-desc step, tree-ordered). */
type Action = { fwd: Desc[][]; inv: Desc[][] };

export class ActionHistory {
  private readonly e: OutlineApi;
  private readonly stack: Action[] = [];
  private readonly redoStack: Action[] = [];
  private current: Action | null = null;

  constructor(e: OutlineApi) {
    this.e = e;
  }

  // ── reads (pass-through) ───────────────────────────────────────────────────
  snapshot(): TreeSnapshot {
    return this.e.snapshot();
  }
  validateInvariants(): void {
    this.e.validateInvariants();
  }
  existsNode(n: NodeId): boolean {
    return this.e.existsNode(n);
  }
  commit(): void {
    this.e.commit();
  }

  // ── action grouping ────────────────────────────────────────────────────────
  begin(): void {
    if (this.current) throw new Error("nested begin() — end the current action first");
    this.current = { fwd: [], inv: [] };
  }
  end(): void {
    if (!this.current) throw new Error("end() without begin()");
    // An action that changed nothing is still a valid (empty) undo step; record it.
    this.stack.push(this.current);
    this.redoStack.length = 0; // any new action invalidates the redo history
    this.current = null;
    this.e.commit();
  }
  /** Helper: run a thunk as one undoable action. */
  run<T>(fn: (h: this) => T): T {
    this.begin();
    const r = fn(this);
    this.end();
    return r;
  }

  canUndo(): boolean {
    return this.stack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  depth(): number {
    return this.stack.length;
  }

  // ── mutations (record into the current action if one is open) ──────────────
  createNode(
    nodeId: NodeId,
    parent: OccurrenceId | null,
    index?: number,
    text?: string,
  ): OccurrenceId {
    const parentNode = this.occToNode(parent);
    const id = this.applyCreateNode(nodeId, parentNode, index, text);
    if (this.current) {
      this.current.fwd.push([{ t: "createNode", nodeId, parent: parentNode, index, text }]);
      this.current.inv.push([{ t: "hardDelete", nodeId }]); // inverse: remove what we just created
    }
    return id;
  }

  createReference(target: NodeId, parent: OccurrenceId | null, index?: number): OccurrenceId {
    const parentNode = this.occToNode(parent);
    const id = this.applyCreateReference(target, parentNode, index);
    if (this.current) {
      this.current.fwd.push([{ t: "createReference", target, parent: parentNode, index }]);
      this.current.inv.push([
        { t: "removeOcc", nodeId: target, parent: parentNode, index: index ?? -1 },
      ]);
    }
    return id;
  }

  moveOccurrence(occ: OccurrenceId, parent: OccurrenceId | null, index?: number): void {
    const snap = this.e.snapshot();
    const nodeId = snap.occurrences[occ]?.nodeId;
    if (!nodeId) return;
    const fromParent = this.occParentNode(snap, occ);
    const fromIndex = this.indexOf(snap, occ);
    const toParent = this.occToNode(parent);
    const toIndex = index ?? this.appendChildCount(snap, parent);
    this.applyMove(nodeId, fromParent, fromIndex, toParent, toIndex);
    if (this.current) {
      this.current.fwd.push([{ t: "move", nodeId, fromParent, fromIndex, toParent, toIndex }]);
      this.current.inv.push([
        {
          t: "move",
          nodeId,
          fromParent: toParent,
          fromIndex: toIndex,
          toParent: fromParent,
          toIndex: fromIndex,
        },
      ]);
    }
  }

  /**
   * Promote an occurrence to canonical (production's promote path). The inverse
   * restores the previous canonical. The occurrence id in the desc is NOT
   * node-stable — it can churn across delete/recreate of this node — so, like the
   * documented transcluded-parent limitation, promote undo assumes the node is not
   * deleted/recreated between the action and its undo.
   */
  setCanonicalOccurrence(nodeId: NodeId, occurrenceId: OccurrenceId): void {
    const old = this.e.snapshot().nodes[nodeId]?.canonicalOccurrenceId;
    this.e.setCanonicalOccurrence(nodeId, occurrenceId);
    if (this.current && old && old !== occurrenceId) {
      this.current.fwd.push([{ t: "setCanonical", nodeId, occurrenceId }]);
      this.current.inv.push([{ t: "setCanonical", nodeId, occurrenceId: old }]);
    }
  }

  setText(nodeId: NodeId, text: string): void {
    const oldText = this.e.snapshot().nodes[nodeId]?.text ?? "";
    this.applySetText(nodeId, text);
    if (this.current) {
      this.current.fwd.push([{ t: "setText", nodeId, text }]);
      this.current.inv.push([{ t: "setText", nodeId, text: oldText }]);
    }
  }

  setEntityProp(nodeId: NodeId, key: string, value: unknown): void {
    const oldVal = this.e.snapshot().nodes[nodeId]?.props[key];
    const had = Object.prototype.hasOwnProperty.call(
      this.e.snapshot().nodes[nodeId]?.props ?? {},
      key,
    );
    this.applySetProp(nodeId, key, value);
    if (this.current) {
      // Inverse: restore old value, or delete the key if it didn't exist.
      this.current.fwd.push([{ t: "setProp", nodeId, key, value }]);
      this.current.inv.push([{ t: "setProp", nodeId, key, value: had ? oldVal : undefined }]);
    }
  }

  /**
   * Rich text: mark a range. The inverse captures the FULL before-delta and
   * restores it, so marks survive undo (a plain-text inverse would drop them).
   * Coarse (snapshots the whole content delta per op) but obviously mark-safe.
   */
  markText(nodeId: NodeId, start: number, end: number, key: string, value: unknown): void {
    const before = this.e.contentDelta(nodeId);
    this.e.markText(nodeId, start, end, key, value);
    if (this.current) {
      this.current.fwd.push([{ t: "markText", nodeId, start, end, key, value }]);
      this.current.inv.push([{ t: "applyContentDelta", nodeId, delta: before }]);
    }
  }

  /** Rich text: insert a string. Inverse restores the before-delta (marks preserved). */
  insertText(nodeId: NodeId, pos: number, str: string): void {
    const before = this.e.contentDelta(nodeId);
    this.e.insertText(nodeId, pos, str);
    if (this.current) {
      this.current.fwd.push([{ t: "insertText", nodeId, pos, str }]);
      this.current.inv.push([{ t: "applyContentDelta", nodeId, delta: before }]);
    }
  }

  removeOccurrence(occ: OccurrenceId): void {
    const snap = this.e.snapshot();
    const nodeId = snap.occurrences[occ]?.nodeId;
    if (!nodeId) return;
    const parentNode = this.occParentNode(snap, occ);
    const index = this.indexOf(snap, occ);
    const before = this.e.snapshot();
    this.e.removeOccurrence(occ);
    if (this.current) {
      const restore = diffToRestore(before, this.e.snapshot());
      this.current.fwd.push([{ t: "removeOcc", nodeId, parent: parentNode, index }]);
      this.current.inv.push(restore);
    }
  }

  hardDeleteNode(nodeId: NodeId): void {
    if (!this.e.existsNode(nodeId)) return;
    const before = this.e.snapshot();
    this.e.hardDeleteNode(nodeId);
    if (this.current) {
      const restore = diffToRestore(before, this.e.snapshot());
      this.current.fwd.push([{ t: "hardDelete", nodeId }]);
      this.current.inv.push(restore);
    }
  }

  // ── undo / redo ────────────────────────────────────────────────────────────
  undo(): boolean {
    if (!this.stack.length) return false;
    const a = this.stack.pop()!;
    // Apply inverse steps in reverse order (last-in, first-undone); within a
    // step, descs are already tree-ordered (parents before children).
    for (let i = a.inv.length - 1; i >= 0; i--) for (const d of a.inv[i]!) this.applyDesc(d);
    this.redoStack.push(a);
    this.e.commit();
    return true;
  }

  redo(): boolean {
    if (!this.redoStack.length) return false;
    const a = this.redoStack.pop()!;
    for (const step of a.fwd) for (const d of step) this.applyDesc(d);
    this.stack.push(a);
    this.e.commit();
    return true;
  }

  // ── desc application (re-resolves occurrences from live state each time) ────
  private applyDesc(d: Desc): void {
    switch (d.t) {
      case "createNode":
        this.applyCreateNode(d.nodeId, d.parent, d.index, d.text);
        break;
      case "createReference":
        this.applyCreateReference(d.target, d.parent, d.index);
        break;
      case "move":
        this.applyMove(d.nodeId, d.fromParent, d.fromIndex, d.toParent, d.toIndex);
        break;
      case "setCanonical":
        this.e.setCanonicalOccurrence(d.nodeId, d.occurrenceId);
        break;
      case "setText":
        this.applySetText(d.nodeId, d.text);
        break;
      case "setProp":
        this.applySetProp(d.nodeId, d.key, d.value);
        break;
      case "markText":
        this.e.markText(d.nodeId, d.start, d.end, d.key, d.value);
        break;
      case "insertText":
        this.e.insertText(d.nodeId, d.pos, d.str);
        break;
      case "applyContentDelta":
        this.e.applyContentDelta(d.nodeId, d.delta);
        break;
      case "hardDelete":
        this.e.hardDeleteNode(d.nodeId);
        break;
      case "removeOcc": {
        const occ = this.findOcc(this.e.snapshot(), d.nodeId, d.parent, d.index);
        if (occ) this.e.removeOccurrence(occ);
        break;
      }
    }
  }

  private applyCreateNode(
    nodeId: NodeId,
    parent: ParentNode,
    index: number | undefined,
    text: string | undefined,
  ): OccurrenceId {
    const parentOcc = this.nodeToCanonOcc(parent);
    return this.e.createNode(nodeId, parentOcc, index, text);
  }
  private applyCreateReference(
    target: NodeId,
    parent: ParentNode,
    index: number | undefined,
  ): OccurrenceId {
    const parentOcc = this.nodeToCanonOcc(parent);
    return this.e.createReference(target, parentOcc, index);
  }
  private applyMove(
    nodeId: NodeId,
    fromParent: ParentNode,
    fromIndex: number,
    toParent: ParentNode,
    toIndex: number,
  ): void {
    const snap = this.e.snapshot();
    const occ = this.findOcc(snap, nodeId, fromParent, fromIndex);
    if (!occ) return; // nothing to move (already in target shape)
    const toOcc = this.nodeToCanonOcc(toParent);
    this.e.moveOccurrence(occ, toOcc, toIndex);
  }
  private applySetText(nodeId: NodeId, text: string): void {
    this.e.setText(nodeId, text);
  }
  private applySetProp(nodeId: NodeId, key: string, value: unknown): void {
    if (value === undefined) {
      // best-effort restore of a previously-absent key: set to null (engine has no delete-prop)
      this.e.setEntityProp(nodeId, key, null);
    } else {
      this.e.setEntityProp(nodeId, key, value);
    }
  }

  // ── occurrence/node resolution helpers (all via live snapshot) ─────────────
  private occToNode(occ: OccurrenceId | null | undefined): ParentNode {
    if (!occ) return null;
    return this.e.snapshot().occurrences[occ]?.nodeId ?? null;
  }
  /** The nodeId of the given occurrence's parent (null if root). */
  private occParentNode(snap: TreeSnapshot, occ: OccurrenceId): ParentNode {
    const pOcc = snap.occurrences[occ]?.parentOccurrenceId;
    if (!pOcc) return null;
    return snap.occurrences[pOcc]?.nodeId ?? null;
  }
  /** Resolve parent nodeId → its canonical occurrence (undo-stable reference). */
  private nodeToCanonOcc(node: ParentNode): OccurrenceId | null {
    if (!node) return null;
    const id = this.e.snapshot().nodes[node]?.canonicalOccurrenceId;
    if (!id) throw new Error(`undo: parent node not found: ${node}`);
    return id;
  }
  private indexOf(snap: TreeSnapshot, occ: OccurrenceId): number {
    const o = snap.occurrences[occ];
    if (!o || !o.parentOccurrenceId) return 0;
    const parent = snap.occurrences[o.parentOccurrenceId];
    return parent ? parent.childOccurrenceIds.indexOf(occ) : 0;
  }
  private appendChildCount(snap: TreeSnapshot, parent: OccurrenceId | null): number {
    if (!parent) return snap.roots.length;
    return snap.occurrences[parent]?.childOccurrenceIds.length ?? 0;
  }
  /** Find the occurrence of nodeId under parentNode at the given child index. */
  private findOcc(
    snap: TreeSnapshot,
    nodeId: NodeId,
    parentNode: ParentNode,
    index: number,
  ): OccurrenceId | undefined {
    for (const [occId, occ] of Object.entries(snap.occurrences)) {
      if (occ.nodeId !== nodeId) continue;
      const pOcc = occ.parentOccurrenceId;
      const pNode = pOcc ? (snap.occurrences[pOcc]?.nodeId ?? null) : null;
      if (pNode !== parentNode) continue;
      const pChildren = pOcc ? snap.occurrences[pOcc]?.childOccurrenceIds : snap.roots;
      if ((pChildren ?? []).indexOf(occId) === index) return occId;
    }
    return undefined;
  }
}

// OccurrenceId is an opaque string; parent is read from a snapshot.

/**
 * Compute the descs that RECREATE everything present in `before` but gone in
 * `after` (the inverse of a cascading delete). Two passes, each in tree order
 * (parents first):
 *   1. createNode for every gone node at its canonical occurrence (+ content/props);
 *   2. createReference for every gone non-canonical occurrence.
 *
 * WHY two passes: a createReference needs its target's entity to exist, so EVERY
 * createNode must precede EVERY createReference. When canonical was always the
 * first-created occurrence this held by accident; `setCanonicalOccurrence`
 * (promote) makes the canonical land at any DFS position, so a reference earlier
 * in DFS than the canonical would otherwise be recreated first and throw
 * (entity-missing). Tree order within each pass keeps parent-before-child so a
 * restored parent occurrence exists before its restored children.
 *
 * Residual limitation: a createNode whose parent occurrence is itself a restored
 * reference (cross-pass dependency) is not handled — consistent with the
 * transcluded-parent undo limitation.
 */
function diffToRestore(before: TreeSnapshot, after: TreeSnapshot): Desc[] {
  const creates: Desc[] = [];
  const refs: Desc[] = [];
  const occExistsAfter = (
    occId: OccurrenceId,
    occ: { nodeId: NodeId; parentOccurrenceId: OccurrenceId | null },
  ): boolean => {
    // An occurrence "still exists" in `after` if some occ there has the same
    // nodeId under the same parent node (position-stable, not id-stable).
    const pNode = occ.parentOccurrenceId
      ? (before.occurrences[occ.parentOccurrenceId]?.nodeId ?? null)
      : null;
    for (const o of Object.values(after.occurrences)) {
      if (o.nodeId !== occ.nodeId) continue;
      const oP = o.parentOccurrenceId
        ? (after.occurrences[o.parentOccurrenceId]?.nodeId ?? null)
        : null;
      if (oP === pNode) return true;
    }
    return false;
  };

  const visit = (occId: OccurrenceId): void => {
    const occ = before.occurrences[occId];
    if (!occ) return;
    const nodeGone = !(occ.nodeId in after.nodes);
    const occGone = !occExistsAfter(occId, occ);
    if (nodeGone || occGone) {
      const parentNode = occ.parentOccurrenceId
        ? (before.occurrences[occ.parentOccurrenceId]?.nodeId ?? null)
        : null;
      const pChildren = occ.parentOccurrenceId
        ? before.occurrences[occ.parentOccurrenceId]?.childOccurrenceIds
        : before.roots;
      const index = (pChildren ?? []).indexOf(occId);
      const isCanon = before.nodes[occ.nodeId]?.canonicalOccurrenceId === occId;
      if (nodeGone && isCanon) {
        const n = before.nodes[occ.nodeId]!;
        creates.push({
          t: "createNode",
          nodeId: occ.nodeId,
          parent: parentNode,
          index,
          text: n.text,
        });
        const propEntries = Object.entries(n.props);
        if (propEntries.length)
          for (const [k, v] of propEntries)
            creates.push({ t: "setProp", nodeId: occ.nodeId, key: k, value: v });
      } else {
        // Non-canonical occurrence of a removed node, or a removed reference to a still-living node.
        refs.push({ t: "createReference", target: occ.nodeId, parent: parentNode, index });
      }
    }
    for (const c of occ.childOccurrenceIds ?? []) visit(c);
  };
  for (const r of before.roots) visit(r);
  return [...creates, ...refs];
}
