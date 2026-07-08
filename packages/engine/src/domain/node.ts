import {
  cascadeHardDelete,
  cascadeRemove,
  type Engine,
  type NodeOccurrence,
} from "../core/index.js";
import { invalidDomainInput } from "./errors.js";
import { assertNodeHardDeleteAllowed } from "./hard-delete-policy.js";
import { assertNotActiveManagedChild } from "./managed-child-policy.js";

export async function createPlainNode(
  doc: Engine,
  parentOccurrenceId?: string | null,
  index?: number,
  props?: Record<string, unknown>,
): Promise<NodeOccurrence> {
  return doc.createNode(await canonicalChildOwnerOf(doc, parentOccurrenceId), index, props);
}

/** Product-level node creation: enforces the single-root workspace policy (one workspace = one
 *  content tree). A null parent is legal only before the workspace's root exists; once rooted,
 *  every node must attach under it. This is the narrow point all user node creation funnels
 *  through — the `createPlainNode` RPC handler + in-process callers. The bare `createPlainNode`
 *  (multi-root) stays for engine tests and the owner-gated root seed at `createWorkspace`, which
 *  deliberately bypass this guard to plant the one sanctioned root. */
export async function createPlainNodeInWorkspace(
  doc: Engine,
  parentOccurrenceId?: string | null,
  index?: number,
  props?: Record<string, unknown>,
): Promise<NodeOccurrence> {
  if (parentOccurrenceId == null && (await doc.getRootOccurrences()).length > 0) {
    invalidDomainInput(
      "createPlainNode: workspace already has a root; pass parentOccurrenceId to attach under it",
      { reason: "workspace_already_rooted" },
    );
  }
  return createPlainNode(doc, parentOccurrenceId, index, props);
}

export async function createReference(
  doc: Engine,
  targetNodeId: string,
  parentOccurrenceId?: string | null,
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
 *  editing paths (indent/outdent). The bare forest primitive is core `Engine.moveOccurrence`. */
export async function moveOccurrence(
  doc: Engine,
  occurrenceId: string,
  parentOccurrenceId: string | null,
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
  parentOccurrenceId?: string | null,
  index?: number,
): Promise<NodeOccurrence> {
  // One undo step for the whole subtree clone. The recursion uses the inner fn so it does
  // not open its own group (transact is re-entrant anyway, but this avoids redundant snapshots).
  return doc.batch(async () =>
    cloneOccurrenceInner(doc, occurrenceId, parentOccurrenceId ?? null, index),
  );
}

async function cloneOccurrenceInner(
  doc: Engine,
  occurrenceId: string,
  parentOccurrenceId: string | null,
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

/** Product-level hard delete: runs the protected-node guard, then the bare cascade. The guard
 *  checks the node, all its occurrences, and the full descendant subtree — so the cascade cannot
 *  nuke a protected entity even when reached via a non-RPC caller. */
export async function hardDeleteNode(doc: Engine, nodeId: string): Promise<void> {
  await assertNodeHardDeleteAllowed(doc, nodeId);
  await cascadeHardDelete(doc, nodeId);
}

export async function getSemanticChildren(
  doc: Engine,
  occurrenceId: string,
): Promise<NodeOccurrence[]> {
  const ownerId = await canonicalChildOwnerOf(doc, occurrenceId);
  return ownerId == null ? [] : doc.getOccurrenceChildren(ownerId);
}

async function canonicalChildOwnerOf(
  doc: Engine,
  occurrenceId?: string | null,
): Promise<string | null> {
  if (occurrenceId == null) {
    return null;
  }
  return doc.getCanonicalOccurrenceId((await doc.mustGetOccurrence(occurrenceId)).nodeId);
}
