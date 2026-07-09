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
  doc: Engine,
  displayName?: string,
): Promise<NodeOccurrence> {
  const existing = await doc.getRootOccurrences();
  if (existing.length > 0) {
    return existing.at(0)!;
  }
  const root = await doc.createNode(null);
  if (displayName !== undefined) {
    await doc.replaceDeltas(root.occurrenceId, [{ insert: displayName }]);
  }
  return root;
}

/** Product-level node creation under a required parent (canonicalized — the child attaches under
 *  the parent's canonical occurrence, so it is visible from every ref). Structurally cannot root. */
export async function createPlainNode(
  doc: Engine,
  parentOccurrenceId: string,
  index?: number,
  props?: Record<string, unknown>,
): Promise<NodeOccurrence> {
  return doc.createNode(await canonicalChildOwnerOf(doc, parentOccurrenceId), index, props);
}

export async function createReference(
  doc: Engine,
  targetNodeId: string,
  parentOccurrenceId: string,
  index?: number,
): Promise<NodeOccurrence> {
  return doc.createOccurrence(
    targetNodeId,
    await canonicalChildOwnerOf(doc, parentOccurrenceId),
    index,
  );
}

/** Product-level move: runs the managed-child guard, then resolves the semantic parent and moves.
 *  This is the narrow point every move funnels through — RPC (`moveNode`), in-process callers, and
 *  editing paths (indent/outdent/moveSibling). A move always takes a parent (single-root: there is no
 *  move-to-root), exactly like the creators. The bare forest primitive is core `Engine.moveOccurrence`. */
export async function moveOccurrence(
  doc: Engine,
  occurrenceId: string,
  parentOccurrenceId: string,
  index?: number,
): Promise<void> {
  await assertNotActiveManagedChild(doc, occurrenceId);
  await doc.moveOccurrence(
    occurrenceId,
    await canonicalChildOwnerOf(doc, parentOccurrenceId),
    index,
  );
}

export async function cloneOccurrence(
  doc: Engine,
  occurrenceId: string,
  parentOccurrenceId: string,
  index?: number,
): Promise<NodeOccurrence> {
  // One undo step for the whole subtree clone. The recursion uses the inner fn so it does
  // not open its own group (transact is re-entrant anyway, but this avoids redundant snapshots).
  return doc.batch(async () => cloneOccurrenceInner(doc, occurrenceId, parentOccurrenceId, index));
}

async function cloneOccurrenceInner(
  doc: Engine,
  occurrenceId: string,
  parentOccurrenceId: string,
  index?: number,
): Promise<NodeOccurrence> {
  const clone = await createPlainNode(
    doc,
    parentOccurrenceId,
    index,
    await doc.getProps(occurrenceId),
  );
  await doc.replaceDeltas(clone.occurrenceId, await doc.getDeltas(occurrenceId));
  for (const child of await getSemanticChildren(doc, occurrenceId)) {
    await cloneOccurrenceInner(doc, child.occurrenceId, clone.occurrenceId);
  }
  return doc.mustGetOccurrence(clone.occurrenceId);
}

export async function promoteCanonicalOccurrence(
  doc: Engine,
  nodeId: string,
  occurrenceId: string,
): Promise<void> {
  const oldCanonicalId = await doc.getCanonicalOccurrenceId(nodeId);
  if (oldCanonicalId === occurrenceId) {
    return;
  }
  const childIds = doc.getChildOccurrenceIds(oldCanonicalId);
  await doc.batch(async () => {
    for (const [index, childId] of childIds.entries()) {
      await doc.moveOccurrence(childId, occurrenceId, index);
    }
    await doc.setCanonicalOccurrence(nodeId, occurrenceId);
  });
}

/** Product-level leaf-only remove: runs the managed-child guard, then the core leaf remove. Mirrors
 *  core `Engine.removeOccurrence` (throws on canonical / non-leaf) plus the guard — the narrow point
 *  every single-occurrence user remove funnels through (`removeNodeOccurrence` RPC, in-process). */
export async function removeOccurrence(doc: Engine, occurrenceId: string): Promise<void> {
  await assertNotActiveManagedChild(doc, occurrenceId);
  await doc.removeOccurrence(occurrenceId);
}

/** Product-level cascade remove: runs the managed-child guard on the seed, then the bare cascade.
 *  Authorized system callers that legitimately remove a managed entity (e.g. `removeField`, which
 *  carries its own `assertFieldRemoveAllowed`) use the bare core `cascadeRemove` directly. */
export async function removeOccurrenceOrHardDelete(
  doc: Engine,
  occurrenceId: string,
): Promise<void> {
  await assertNotActiveManagedChild(doc, occurrenceId);
  await cascadeRemove(doc, occurrenceId);
}

/** Product-level hard delete: authorize and apply share ONE closure (the exact set the core
 *  cascade will remove) — so the guard cannot diverge from the delete. A protected node anywhere
 *  in the deletion closure (including under a non-canonical occurrence) is caught, because the
 *  closure walked to authorize is the same one walked to remove. */
export async function hardDeleteNode(doc: Engine, nodeId: string): Promise<void> {
  await doc.batch(async () => {
    const seeds = (await doc.getOccurrences(nodeId)).map((occ) => occ.occurrenceId);
    const { removed, deletedNodes } = await cascadeClosure(doc, seeds);
    await authorizeHardDelete(doc, removed);
    await applyCascade(doc, removed, deletedNodes);
  });
}

export async function getSemanticChildren(
  doc: Engine,
  occurrenceId: string,
): Promise<NodeOccurrence[]> {
  return doc.getOccurrenceChildren(await canonicalChildOwnerOf(doc, occurrenceId));
}

async function canonicalChildOwnerOf(doc: Engine, occurrenceId: string): Promise<string> {
  if (!occurrenceId) {
    // The one parent-required guard, shared by every creator and the move — an empty/missing parent
    // is an invalid argument (distinct from a NotFoundError for a real-but-absent id). Catches a
    // client that sends no parent (proto3 empty default) at the single funnel all of them go through.
    invalidDomainInput("parent occurrence id required (parent_required)", {
      reason: "parent_required",
    });
  }
  return doc.getCanonicalOccurrenceId((await doc.mustGetOccurrence(occurrenceId)).nodeId);
}
