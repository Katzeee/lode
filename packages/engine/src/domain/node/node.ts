import {
  applyCascade,
  cascadeClosure,
  cascadeRemove,
  type Engine,
  type NodeOccurrence,
} from "../../core/index.js";
import { invalidDomainInput } from "../errors.js";
import { authorizeHardDelete } from "./hard-delete-policy.js";
import { assertNotActiveManagedChild } from "../managed/managed-child-policy.js";

/** The single sanctioned root producer. Idempotent: if the workspace already has a root, returns
 *  it unchanged — there is no second rooting path anywhere in the domain. This is the ONLY entry
 *  that calls core `createNode(null)`; every product creator below takes a required parent, so the
 *  single-root policy is a type fact, not a runtime check. */
export async function createWorkspaceRoot(
  engine: Engine,
  displayName?: string,
): Promise<NodeOccurrence> {
  const existing = await engine.getRootOccurrences();
  if (existing.length > 0) {
    return existing.at(0)!;
  }
  const root = await engine.createNode(null);
  if (displayName !== undefined) {
    await engine.replaceDeltas(root.occurrenceId, [{ insert: displayName }]);
  }
  return root;
}

/** Product-level node creation under a required parent (canonicalized — the child attaches under
 *  the parent's canonical occurrence, so it is visible from every ref). Structurally cannot root. */
export async function createPlainNode(
  engine: Engine,
  parentOccurrenceId: string,
  index?: number,
  props?: Record<string, unknown>,
): Promise<NodeOccurrence> {
  return engine.createNode(await canonicalChildOwnerOf(engine, parentOccurrenceId), index, props);
}

export async function createReference(
  engine: Engine,
  targetNodeId: string,
  parentOccurrenceId: string,
  index?: number,
): Promise<NodeOccurrence> {
  return engine.createOccurrence(
    targetNodeId,
    await canonicalChildOwnerOf(engine, parentOccurrenceId),
    index,
  );
}

/** Product-level move: runs the managed-child guard, then resolves the semantic parent and moves.
 *  This is the narrow point every move funnels through — RPC (`moveNode`), in-process callers, and
 *  editing paths (indent/outdent/moveSibling). A move always takes a parent (single-root: there is no
 *  move-to-root), exactly like the creators. The bare forest primitive is core `Engine.moveOccurrence`. */
export async function moveOccurrence(
  engine: Engine,
  occurrenceId: string,
  parentOccurrenceId: string,
  index?: number,
): Promise<void> {
  await assertNotActiveManagedChild(engine, occurrenceId);
  await engine.moveOccurrence(
    occurrenceId,
    await canonicalChildOwnerOf(engine, parentOccurrenceId),
    index,
  );
}

export async function cloneOccurrence(
  engine: Engine,
  occurrenceId: string,
  parentOccurrenceId: string,
  index?: number,
): Promise<NodeOccurrence> {
  // One undo step for the whole subtree clone. The recursion uses the inner fn so it does
  // not open its own group (transact is re-entrant anyway, but this avoids redundant snapshots).
  return engine.batch(async () =>
    cloneOccurrenceInner(engine, occurrenceId, parentOccurrenceId, index),
  );
}

async function cloneOccurrenceInner(
  engine: Engine,
  occurrenceId: string,
  parentOccurrenceId: string,
  index?: number,
): Promise<NodeOccurrence> {
  const clone = await createPlainNode(
    engine,
    parentOccurrenceId,
    index,
    await engine.getProps(occurrenceId),
  );
  await engine.replaceDeltas(clone.occurrenceId, await engine.getDeltas(occurrenceId));
  for (const child of await getSemanticChildren(engine, occurrenceId)) {
    await cloneOccurrenceInner(engine, child.occurrenceId, clone.occurrenceId);
  }
  return engine.mustGetOccurrence(clone.occurrenceId);
}

export async function promoteCanonicalOccurrence(
  engine: Engine,
  nodeId: string,
  occurrenceId: string,
): Promise<void> {
  const oldCanonicalId = await engine.getCanonicalOccurrenceId(nodeId);
  if (oldCanonicalId === occurrenceId) {
    return;
  }
  const childIds = engine.getChildOccurrenceIds(oldCanonicalId);
  await engine.batch(async () => {
    for (const [index, childId] of childIds.entries()) {
      await engine.moveOccurrence(childId, occurrenceId, index);
    }
    await engine.setCanonicalOccurrence(nodeId, occurrenceId);
  });
}

/** Product-level leaf-only remove: runs the managed-child guard, then the core leaf remove. Mirrors
 *  core `Engine.removeOccurrence` (throws on canonical / non-leaf) plus the guard — the narrow point
 *  every single-occurrence user remove funnels through (`removeNodeOccurrence` RPC, in-process). */
export async function removeOccurrence(engine: Engine, occurrenceId: string): Promise<void> {
  await assertNotActiveManagedChild(engine, occurrenceId);
  await engine.removeOccurrence(occurrenceId);
}

/** Product-level cascade remove: runs the managed-child guard on the seed, then the bare cascade.
 *  Authorized system callers that legitimately remove a managed entity (e.g. `removeField`, which
 *  carries its own `assertFieldRemoveAllowed`) use the bare core `cascadeRemove` directly. */
export async function removeOccurrenceOrHardDelete(
  engine: Engine,
  occurrenceId: string,
): Promise<void> {
  await assertNotActiveManagedChild(engine, occurrenceId);
  await cascadeRemove(engine, occurrenceId);
}

/** Product-level hard delete: authorize and apply share ONE closure (the exact set the core
 *  cascade will remove) — so the guard cannot diverge from the delete. A protected node anywhere
 *  in the deletion closure (including under a non-canonical occurrence) is caught, because the
 *  closure walked to authorize is the same one walked to remove. */
export async function hardDeleteNode(engine: Engine, nodeId: string): Promise<void> {
  await engine.batch(async () => {
    const seeds = (await engine.getOccurrences(nodeId)).map((occ) => occ.occurrenceId);
    const { removed, deletedNodes } = await cascadeClosure(engine, seeds);
    await authorizeHardDelete(engine, removed);
    await applyCascade(engine, removed, deletedNodes);
  });
}

export async function getSemanticChildren(
  engine: Engine,
  occurrenceId: string,
): Promise<NodeOccurrence[]> {
  return engine.getOccurrenceChildren(await canonicalChildOwnerOf(engine, occurrenceId));
}

async function canonicalChildOwnerOf(engine: Engine, occurrenceId: string): Promise<string> {
  if (!occurrenceId) {
    // The one parent-required guard, shared by every creator and the move — an empty/missing parent
    // is an invalid argument (distinct from a NotFoundError for a real-but-absent id). Catches a
    // client that sends no parent (proto3 empty default) at the single funnel all of them go through.
    invalidDomainInput("parent occurrence id required (parent_required)", {
      reason: "parent_required",
    });
  }
  return engine.getCanonicalOccurrenceId((await engine.mustGetOccurrence(occurrenceId)).nodeId);
}
