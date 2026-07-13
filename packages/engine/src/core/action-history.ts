/* eslint-disable max-lines -- one undo mechanism; snapshot-diff + reconcile kept together */
import type { Delta, NodeId, OccurrenceId } from "./types.js";
import type { DocSnapshot, NodeEntitySnapshot, NodeOccurrenceSnapshot } from "./types.js";
import type { Engine } from "./engine.js";
import { toJSONOccurrences } from "./serialize.js";

/**
 * ENGINE-layer undo/redo (business-agnostic). Snapshot-diff style (anytype-heart's
 * `core/block/undo`): each action stores the before/after state of ONLY the occurrences
 * and entities that changed, identified by the PERMANENT `occId` (stable across the
 * delete/recreate churn that undo itself causes). Undo restores `before` forward through
 * the Engine's own mutators; redo restores `after`.
 *
 * This replaces the old command-inverse descriptors, which were node-stable (parent as a
 * nodeId, re-resolved to the canonical occurrence at apply time) and therefore imprecise
 * under multi-occurrence transclusion — a move whose target parent had several
 * occurrences re-resolved to a different occurrence than the original, so the recorded
 * index no longer fit. Snapshot-diff keyed by occId is exact.
 *
 * Reconciliation runs through Engine mutators (so events fire and the store stays the
 * single authority). Deletes run bottom-up (leaf first — removeOccurrence/deleteNode
 * reject non-leaf/canonical); creates run top-down (parent first — a child can't attach
 * under an occurrence that doesn't exist yet).
 */

/** A changed occurrence. `occId` is the permanent reconciliation key; `occurrenceId` is
 *  the live Loro tree id at snapshot time (carried for diagnostics only). Parent and
 *  children are expressed as occIds so they survive live-id churn between snapshots.
 *  `indexInParent` is this occurrence's position among its parent's physical children (or
 *  among roots when parentOccId is null), captured at snapshot time so undo can restore
 *  sibling/root order even when only one child changed. */
type AffectedOccurrence = {
  occId: string;
  occurrenceId: OccurrenceId;
  nodeId: NodeId;
  parentOccId: string | null;
  indexInParent: number;
  childOccIds: string[];
  occurrenceProps: Record<string, unknown>;
  occurrenceMeta: Record<string, unknown>;
};

/** A changed entity (node content/canonical/props/meta), keyed by nodeId. canonicalOccId
 *  is the permanent occId of the canonical occurrence (snapshot-stable). */
type AffectedEntity = {
  nodeId: NodeId;
  canonicalOccId: string;
  deltas: Delta;
  props: Record<string, unknown>;
  meta: Record<string, unknown>;
};

type AffectedState = {
  occurrences: AffectedOccurrence[];
  entities: AffectedEntity[];
};

/** An action = before/after of everything that changed. Undo restores `before`; redo
 *  restores `after`. */
type Action = { before: AffectedState; after: AffectedState };

export class ActionHistory {
  private readonly stack: Action[] = [];
  private readonly redoStack: Action[] = [];
  /** Incremental capture state for the in-flight action (null between actions). Occurrences are
   *  captured treeDoc-only (no shard reads); entities are captured only for nodeIds whose entity
   *  mutates during the action (first-touch-wins before-images). Replaces the old full-toJSON
   *  snapshot — undo no longer faults untouched shards. */
  private beforeOcc: {
    occurrences: NodeOccurrenceSnapshot[];
    rootOccurrenceIds: OccurrenceId[];
  } | null = null;
  private entityBefore: Map<NodeId, NodeEntitySnapshot | null> | null = null;

  constructor(private readonly engine: Engine) {}

  // ── action grouping ────────────────────────────────────────────────────────
  begin(): void {
    if (this.beforeOcc) {
      throw new Error("nested begin() — end the current action first");
    }
    this.entityBefore = new Map();
    // Each entity-mutating mutator records its pre-mutation entity here (first-touch-wins).
    this.engine.setEntityCapture((nodeId, before) => {
      if (!this.entityBefore!.has(nodeId)) {
        this.entityBefore!.set(nodeId, before);
      }
    });
    this.beforeOcc = toJSONOccurrences(this.engine);
  }
  async end(): Promise<void> {
    if (!this.beforeOcc || !this.entityBefore) {
      throw new Error("end() without begin()");
    }
    this.engine.setEntityCapture(null); // stop capturing before the after-read
    const beforeOcc = this.beforeOcc;
    const entityBefore = this.entityBefore;
    this.beforeOcc = null;
    this.entityBefore = null;

    const afterOcc = toJSONOccurrences(this.engine);
    // After-image: each touched nodeId's CURRENT entity, or absent (the action deleted it — covered
    // by the before-side diff). Reads only the touched set's shards.
    const entityAfterList: NodeEntitySnapshot[] = [];
    for (const nodeId of entityBefore.keys()) {
      const after = await this.engine.getEntitySnapshot(nodeId);
      if (after) {
        entityAfterList.push(after);
      }
    }
    const entityBeforeList = [...entityBefore.values()].filter(
      (s): s is NodeEntitySnapshot => s !== null,
    );
    // Reuse the unchanged `diffState` by synthesizing DocSnapshots from the targeted pieces. The
    // resulting AffectedState is byte-equivalent to the old full-snapshot diff.
    const beforeSnap: DocSnapshot = {
      version: 4,
      occurrences: beforeOcc.occurrences,
      entities: entityBeforeList,
      rootOccurrenceIds: beforeOcc.rootOccurrenceIds,
    };
    const afterSnap: DocSnapshot = {
      version: 4,
      occurrences: afterOcc.occurrences,
      entities: entityAfterList,
      rootOccurrenceIds: afterOcc.rootOccurrenceIds,
    };
    const action = {
      before: diffState(beforeSnap, afterSnap),
      after: diffState(afterSnap, beforeSnap),
    };
    // Always push, even for an empty diff (a no-op op like moving a root to root). This
    // keeps the 1:1 op↔undo-step contract callers expect: each top-level op is one undo,
    // and undoing a no-op is itself a no-op (reconcile of empty before/after does nothing).
    this.stack.push(action);
    this.redoStack.length = 0;
    this.engine.captureSync();
  }
  /** Run a thunk as one undoable action. */
  async run<T>(fn: () => T | Promise<T>): Promise<T> {
    this.begin();
    const r = await fn();
    await this.end();
    return r;
  }

  canUndo(): boolean {
    return this.stack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  clear(): void {
    this.stack.length = 0;
    this.redoStack.length = 0;
    this.beforeOcc = null;
    this.entityBefore = null;
    this.engine.setEntityCapture(null);
  }

  // ── undo / redo ────────────────────────────────────────────────────────────
  async undo(): Promise<boolean> {
    const a = this.stack.pop();
    if (!a) {
      return false;
    }
    // Restore the before-state. `after` is the reference (what the action changed) so
    // reconcile knows the changed-item boundary and won't touch unrelated occurrences.
    await reconcile(this.engine, a.before, a.after);
    this.redoStack.push(a);
    this.engine.captureSync();
    return true;
  }

  async redo(): Promise<boolean> {
    const a = this.redoStack.pop();
    if (!a) {
      return false;
    }
    await reconcile(this.engine, a.after, a.before);
    this.stack.push(a);
    this.engine.captureSync();
    return true;
  }
}

// ── diffing ────────────────────────────────────────────────────────────────────

/** Build the AffectedState of items present in `main` whose state differs from (or is
 *  absent in) `other`. The captured state is the `main` side. So
 *  `diffState(before, after)` yields the before-state of changed items; the symmetric
 *  call yields the after-state. Items present only in `other` are the "gone" side here
 *  and are covered by the opposite diff. */
function diffState(main: DocSnapshot, other: DocSnapshot): AffectedState {
  const otherAffByOccId = new Map(
    other.occurrences.map((o) => [o.occId, toAffectedOccurrence(other, o)]),
  );
  const entityByNodeId = new Map(other.entities.map((e) => [e.nodeId, e]));

  const occurrences: AffectedOccurrence[] = [];
  for (const o of main.occurrences) {
    const a = toAffectedOccurrence(main, o);
    const otherAff = otherAffByOccId.get(a.occId);
    if (otherAff && sameAffectedOccurrence(a, otherAff)) {
      continue;
    }
    occurrences.push(a);
  }

  const entities: AffectedEntity[] = [];
  for (const e of main.entities) {
    const otherEnt = entityByNodeId.get(e.nodeId);
    if (otherEnt && sameEntity(e, otherEnt)) {
      continue;
    }
    entities.push({
      nodeId: e.nodeId,
      // canonicalOccurrenceId is a live id in the snapshot; store the matching permanent
      // occId so reconciliation is stable across delete/recreate. toJSON is closed under
      // reachability so the canonical occurrence is always carried; the `??` is defensive.
      canonicalOccId: occIdOfOccurrenceId(main, e.canonicalOccurrenceId) ?? e.canonicalOccurrenceId,
      deltas: e.deltas.map((d) => ({ ...d, attributes: d.attributes && { ...d.attributes } })),
      props: { ...e.props },
      meta: { ...e.meta },
    });
  }
  return { occurrences, entities };
}

/** Project a snapshot occurrence into its AffectedOccurrence form, resolving its parent
 *  and children to PERMANENT occIds (so the stored state is live-id-independent), and
 *  capturing its index among its parent's children (or among roots). */
function toAffectedOccurrence(snap: DocSnapshot, o: NodeOccurrenceSnapshot): AffectedOccurrence {
  const occIdByOccurrenceId = new Map(snap.occurrences.map((x) => [x.occurrenceId, x.occId]));
  const parentOccId = o.parentOccurrenceId
    ? (occIdByOccurrenceId.get(o.parentOccurrenceId) ?? null)
    : null;
  // Index among the parent's physical children, or among roots. Captured at snapshot time
  // so reconcile can restore the exact position even when siblings weren't part of the diff.
  const indexInParent = o.parentOccurrenceId
    ? (snap.occurrences
        .find((x) => x.occurrenceId === o.parentOccurrenceId)
        ?.physicalChildOccurrenceIds.indexOf(o.occurrenceId) ?? 0)
    : snap.rootOccurrenceIds.indexOf(o.occurrenceId);
  return {
    occId: o.occId,
    occurrenceId: o.occurrenceId,
    nodeId: o.nodeId,
    parentOccId,
    indexInParent: Math.max(0, indexInParent),
    childOccIds: o.physicalChildOccurrenceIds.map((cid) => occIdByOccurrenceId.get(cid) ?? cid),
    occurrenceProps: { ...o.occurrenceProps },
    occurrenceMeta: { ...o.occurrenceMeta },
  };
}

function occIdOfOccurrenceId(snap: DocSnapshot, occurrenceId: OccurrenceId): string | undefined {
  return snap.occurrences.find((o) => o.occurrenceId === occurrenceId)?.occId;
}

/** Compare two occId-keyed AffectedOccurrences (parent + children already on the
 *  permanent key, so the comparison is live-id-churn-proof). `indexInParent` is included
 *  so a pure reorder (same parent, same children, new position among siblings/roots) is
 *  captured as a change — otherwise undo wouldn't restore sibling/root order. */
function sameAffectedOccurrence(a: AffectedOccurrence, b: AffectedOccurrence): boolean {
  return (
    a.nodeId === b.nodeId &&
    a.parentOccId === b.parentOccId &&
    a.indexInParent === b.indexInParent &&
    sameStringList(a.childOccIds, b.childOccIds) &&
    sameRecord(a.occurrenceProps, b.occurrenceProps) &&
    sameRecord(a.occurrenceMeta, b.occurrenceMeta)
  );
}

function sameStringList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function sameEntity(a: NodeEntitySnapshot, b: NodeEntitySnapshot): boolean {
  return (
    a.canonicalOccurrenceId === b.canonicalOccurrenceId &&
    sameDelta(a.deltas, b.deltas) &&
    sameRecord(a.props, b.props) &&
    sameRecord(a.meta, b.meta)
  );
}

function sameRecord(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) {
    return false;
  }
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) {
      return false;
    }
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      return false;
    }
  }
  return true;
}

function sameDelta(a: Delta, b: Delta): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── reconciliation ─────────────────────────────────────────────────────────────

/** Restore `wanted` onto the live engine via Engine mutators. `reference` is the action's
 *  OTHER side (the after-state when undoing, the before-state when redoing); it defines
 *  the changed-item boundary so occurrences/entities untouched by the action are left
 *  alone. Only occIds/nodeIds in `wanted ∪ reference` are touched.
 *
 *  Phase order (each phase respects Engine mutator guards):
 *    1. IN-PLACE entity updates for entities currently live (content/props/meta; canonical
 *       is set in Phase 5 once the target occurrence exists).
 *    2. DELETE occurrences bottom-up (deepest first) so each is a leaf when removed.
 *       occIds in `reference` but not `wanted`. Hard-delete nodes whose entity is in
 *       `reference.entities` but not `wanted.entities` and is now leaf.
 *    3. CREATE occurrences top-down (shallowest first) so each parent exists first.
 *       occIds in `wanted` but not `reference`.
 *    4. IN-PLACE occurrence updates for survivors: move/reparent, child order,
 *       occurrence props/meta.
 *    5. CANONICAL restoration (entity-level; after occurrences exist). */
// eslint-disable-next-line max-lines-per-function -- one undo algorithm: a single fixpoint pass over the op log in 5 sequential phases.
async function reconcile(
  engine: Engine,
  wanted: AffectedState,
  reference: AffectedState,
): Promise<void> {
  const live = toJSONOccurrences(engine); // treeDoc-only walk; the targeted engineNodeLive checks below fault only touched shards, never the full set
  const liveOccIdByOccId = new Map<string, OccurrenceId>(); // occId → live occurrenceId
  for (const o of live.occurrences) {
    liveOccIdByOccId.set(o.occId, o.occurrenceId);
  }
  const liveOccByOccurrenceId = new Map(live.occurrences.map((o) => [o.occurrenceId, o]));
  const wantedOccByOccId = new Map(wanted.occurrences.map((o) => [o.occId, o]));
  const wantedEntities = new Map(wanted.entities.map((e) => [e.nodeId, e]));
  const refOccIds = new Set(reference.occurrences.map((o) => o.occId));
  const wantedEntityNodeIds = new Set(wanted.entities.map((e) => e.nodeId));

  // minted during Phase 3 (occId → new live occurrenceId)
  const createdOccByOccId = new Map<string, OccurrenceId>();
  const liveOrCreated = (occId: string): OccurrenceId | undefined =>
    liveOccIdByOccId.get(occId) ?? createdOccByOccId.get(occId);

  // ── Phase 1: in-place entity updates (content/props/meta) ────────────────────
  for (const ent of wanted.entities) {
    if (!(await engineNodeLive(engine, ent.nodeId))) {
      continue; // entity absent — created in Phase 3 (targeted check, not a full entity scan)
    }
    const occ = await engine.getCanonicalOccurrenceId(ent.nodeId);
    if (!sameDelta(await engine.getDeltas(occ), ent.deltas)) {
      await engine.replaceDeltas(occ, ent.deltas);
    }
    await applyRecordDelta(
      await engine.getProps(occ),
      ent.props,
      (key) => engine.unsetProp(occ, key),
      (key, value) => engine.setProp(occ, key, value),
    );
    await applyRecordDelta(
      await engine.getEntityMetaRecord(occ),
      ent.meta,
      (key) => engine.unsetEntityMeta(occ, key),
      (key, value) => engine.setEntityMeta(occ, key, value),
    );
  }

  // ── Phase 2: delete occurrences bottom-up (deepest first) ────────────────────
  // An occId is deletable iff it is in `reference` but NOT in `wanted` (the action
  // created it; restoring `wanted` must remove it). Sort deepest-first so each is a leaf.
  const toDelete = reference.occurrences
    .filter((o) => !wantedOccByOccId.has(o.occId) && liveOccIdByOccId.has(o.occId))
    .map((o) => ({ o, depth: liveDepth(o.occurrenceId, liveOccByOccurrenceId) }))
    .sort((a, b) => b.depth - a.depth);
  for (const { o } of toDelete) {
    const occ = liveOrCreated(o.occId);
    if (occ === undefined) {
      continue;
    }
    if (engine.getChildOccurrenceIds(occ).length > 0) {
      continue; // still has live children (deleted later, deeper-first)
    }
    const liveCanonOcc = await engine.getCanonicalOccurrenceId(o.nodeId);
    const isCanon = liveCanonOcc === occ;
    const liveOccsOfNode = (await engine.getOccurrences(o.nodeId)).map((x) => x.occurrenceId);
    const isLastOfNode = liveOccsOfNode.length === 1;
    const entityUnwanted = !wantedEntityNodeIds.has(o.nodeId);
    if (isCanon) {
      const otherOcc = liveOccsOfNode.find((id) => id !== occ);
      if (otherOcc !== undefined) {
        await engine.setCanonicalOccurrence(o.nodeId, otherOcc);
        await engine.removeOccurrence(occ);
      } else if (isLastOfNode && entityUnwanted) {
        await engine.deleteNode(o.nodeId);
      }
      // else: canonical-of-still-wanted-entity with no alternative — leave; Phase 4 fixes canon.
    } else {
      await engine.removeOccurrence(occ);
    }
  }
  // Entities unwanted (in reference, not wanted) whose node is now leaf & still live:
  // hard-delete so a subsequent recreate (Phase 3) can mint the node fresh.
  for (const ent of reference.entities) {
    if (wantedEntityNodeIds.has(ent.nodeId)) {
      continue;
    }
    if (!(await engineNodeLive(engine, ent.nodeId))) {
      continue;
    }
    const occs = await engine.getOccurrences(ent.nodeId);
    if (
      occs.length === 0 ||
      occs.every((o) => engine.getChildOccurrenceIds(o.occurrenceId).length === 0)
    ) {
      // Promote-away guard: deleteNode rejects a canonical-with-occurrences only when all
      // are leaf; if any occurrence remains, removeOccurrence each first (they're all leaf
      // here per the check, but deleteNode itself removes leftover occurrences).
      try {
        await engine.deleteNode(ent.nodeId);
      } catch {
        // If a leftover occurrence blocks it, leave it — the structural invariant test
        // will flag a real bug; we don't crash undo mid-restore.
      }
    }
  }

  // ── Phase 3: create occurrences top-down (shallowest first) ─────────────────
  // An occId is creatable iff it is in `wanted` but NOT in `reference` (the action
  // deleted it; restoring `wanted` must recreate it), OR it's in `wanted` and not yet
  // live (covers re-creating an occ whose live id churned). Sort shallowest-first so the
  // parent exists before its children.
  const toCreate = wanted.occurrences
    .filter((o) => !refOccIds.has(o.occId) && !liveOccIdByOccId.has(o.occId))
    .map((o) => ({ o, depth: wantedDepth(o.occId, wantedOccByOccId) }))
    .sort((a, b) => a.depth - b.depth);
  for (const { o } of toCreate) {
    const parentOcc = o.parentOccId === null ? null : (liveOrCreated(o.parentOccId) ?? null);
    const index = wantedChildIndex(o);
    const entityWanted = wantedEntities.get(o.nodeId);
    const nodeLive = await engineNodeLive(engine, o.nodeId);
    let occurrenceId: OccurrenceId;
    if (!nodeLive && entityWanted) {
      // First occurrence of a (re)created node — createNode carries props/content/meta.
      const created = await engine.createNode(
        parentOcc,
        index,
        entityWanted.props,
        o.nodeId,
        o.occId,
      );
      occurrenceId = created.occurrenceId;
      if (entityWanted.deltas.length > 0) {
        await engine.replaceDeltas(occurrenceId, entityWanted.deltas);
      }
      for (const [key, value] of Object.entries(entityWanted.meta)) {
        await engine.setEntityMeta(occurrenceId, key, value);
      }
    } else {
      occurrenceId = (await engine.createOccurrence(o.nodeId, parentOcc, index, o.occId))
        .occurrenceId;
    }
    for (const [key, value] of Object.entries(o.occurrenceProps)) {
      await engine.setOccurrenceProp(occurrenceId, key, value);
    }
    for (const [key, value] of Object.entries(o.occurrenceMeta)) {
      await engine.setOccurrenceMeta(occurrenceId, key, value);
    }
    createdOccByOccId.set(o.occId, occurrenceId);
  }

  // ── Phase 4: in-place occurrence updates (move, child order, occ props/meta)
  for (const o of wanted.occurrences) {
    const occ = liveOrCreated(o.occId);
    if (occ === undefined) {
      continue;
    }
    // Parent / position.
    const wantedParentOcc = o.parentOccId === null ? null : (liveOrCreated(o.parentOccId) ?? null);
    const liveParent = engine.getParentOccurrenceId(occ);
    await (wantedParentOcc !== liveParent
      ? engine.moveOccurrence(occ, wantedParentOcc, wantedChildIndex(o))
      : ensureChildOrder(engine, occ, wantedParentOcc, o));
    // Per-occurrence props/meta.
    await applyRecordDelta(
      engine.getOccurrenceProps(occ),
      o.occurrenceProps,
      (key) => engine.unsetOccurrenceProp(occ, key),
      (key, value) => engine.setOccurrenceProp(occ, key, value),
    );
    await applyRecordDelta(
      engine.getOccurrenceMetaRecord(occ),
      o.occurrenceMeta,
      (key) => engine.unsetOccurrenceMeta(occ, key),
      (key, value) => engine.setOccurrenceMeta(occ, key, value),
    );
  }

  // ── Phase 5: canonical restoration (entity-level; runs after occurrences exist) ──
  // Driven by wanted.entities, NOT the occurrence loop — a canonical change touches only
  // the entity pointer, so the target occurrence may be unchanged and absent from the
  // occurrence diff. Set the canonical to the wanted occurrence's live id.
  for (const ent of wanted.entities) {
    const wantedCanonOccId = ent.canonicalOccId;
    const targetOcc = liveOrCreated(wantedCanonOccId);
    if (targetOcc === undefined) {
      continue;
    }
    if ((await engine.getCanonicalOccurrenceId(ent.nodeId)) !== targetOcc) {
      await engine.setCanonicalOccurrence(ent.nodeId, targetOcc);
    }
  }
}

/** Apply a target record onto the live state: unset keys present live but not wanted;
 *  set keys whose value differs. */
async function applyRecordDelta(
  live: Record<string, unknown>,
  target: Record<string, unknown>,
  unset: (key: string) => Promise<void>,
  set: (key: string, value: unknown) => Promise<void>,
): Promise<void> {
  for (const key of Object.keys(live)) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      await unset(key);
    }
  }
  for (const [key, value] of Object.entries(target)) {
    if (JSON.stringify(live[key]) !== JSON.stringify(value)) {
      await set(key, value);
    }
  }
}

/** Depth of an occurrence in the LIVE tree (roots = 0). */
/** Depth of an occurrence in the LIVE tree (roots = 0), via the live parent chain. The live snapshot
 *  carries parentage as `parentOccurrenceId` (the Loro tree id), so the map is keyed by `occurrenceId`
 *  — NOT the permanent `occId` (which keys reconciliation, not live parentage). Mixing the two silently
 *  no-ops the walk (every lookup misses) and flattens depth to 0, breaking the deepest-first delete. */
function liveDepth(
  occurrenceId: OccurrenceId,
  liveOccByOccurrenceId: Map<OccurrenceId, NodeOccurrenceSnapshot>,
): number {
  let depth = 0;
  const seen = new Set<OccurrenceId>([occurrenceId]);
  let cur = liveOccByOccurrenceId.get(occurrenceId);
  while (cur && cur.parentOccurrenceId) {
    const parent = liveOccByOccurrenceId.get(cur.parentOccurrenceId);
    if (!parent) {
      break;
    }
    if (seen.has(parent.occurrenceId)) {
      break;
    }
    seen.add(parent.occurrenceId);
    depth++;
    cur = parent;
  }
  return depth;
}

/** Depth of an occurrence in the WANTED tree (roots = 0), via parent occId chain. */
function wantedDepth(occId: string, wantedOccByOccId: Map<string, AffectedOccurrence>): number {
  let depth = 0;
  const seen = new Set<string>([occId]);
  let cur = wantedOccByOccId.get(occId);
  while (cur && cur.parentOccId !== null) {
    if (seen.has(cur.parentOccId)) {
      break;
    }
    seen.add(cur.parentOccId);
    depth++;
    cur = wantedOccByOccId.get(cur.parentOccId);
  }
  return depth;
}

/** Wanted physical index of `o` among its parent's children (or among roots). The index
 *  was captured at snapshot time (indexInParent), so it is exact for the snapshot's tree
 *  order. During reconcile the live tree may have shifted (e.g. a recreated sibling), but
 *  inserting at the captured index restores the original order because unchanged siblings
 *  retain their relative positions. */
function wantedChildIndex(o: AffectedOccurrence): number {
  return o.indexInParent;
}

/** Ensure an occurrence sits at the right index among its parent's live children. */
async function ensureChildOrder(
  engine: Engine,
  occ: OccurrenceId,
  parentOcc: OccurrenceId | null,
  o: AffectedOccurrence,
): Promise<void> {
  const wantedIndex = wantedChildIndex(o);
  const liveChildren = parentOcc
    ? engine.getChildOccurrenceIds(parentOcc)
    : engine.getRootOccurrenceIds();
  if (liveChildren[wantedIndex] !== occ) {
    await engine.moveOccurrence(occ, parentOcc, wantedIndex);
  }
}

async function engineNodeLive(engine: Engine, nodeId: NodeId): Promise<boolean> {
  // "Entity present AND reachable via a live occurrence" — byte-equivalent to the old
  // `live.entities.find` (toJSON only carries entities reached by walking the occurrence tree).
  // Reconcile reads this per-wanted-entity, so it faults only the touched node's shard, not all.
  try {
    return (await engine.getOccurrences(nodeId)).length > 0;
  } catch {
    return false;
  }
}
