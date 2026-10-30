// Purpose: Owns the node tree: creates incarnations, reads physical ownership, and changes owners across incarnations.

import type { LoroDoc, LoroTree, LoroTreeNode } from "loro-crdt";
import { idOf, Locator, writeId } from "./locator.ts";
import type { NodeId } from "./node-id.ts";

/**
 * The only door to the node tree, so nothing outside it holds a tree node: a tree node is one
 * incarnation, and acting on one alone would split a NodeId. Everything here takes and returns NodeIds.
 */
export class Ownership {
  readonly #tree: LoroTree;
  readonly #locator: Locator;

  constructor(doc: LoroDoc, tree: LoroTree) {
    this.#tree = tree;
    this.#locator = new Locator(doc, tree);
  }

  /** Allocated: some tree node carries the id. Says nothing about presence. */
  has(id: NodeId): boolean {
    return this.#locator.has(id);
  }

  ids(): IterableIterator<NodeId> {
    return this.#locator.ids();
  }

  /**
   * Creates a tree node carrying `id` under `parent`'s canonical incarnation, or as a root, and indexes
   * it at once, so reads inside the open transaction already find it.
   */
  create(id: NodeId, parent: NodeId | undefined): void {
    const under = parent === undefined ? undefined : this.#canonical(parent);
    const node = under ? under.createNode() : this.#tree.createNode();
    writeId(node, id);
    this.#locator.index(node);
  }

  /** The tree parent of each incarnation as a NodeId, canonical first. */
  incarnationParents(id: NodeId): (NodeId | undefined)[] {
    return this.#locator.incarnations(id).map(parentId);
  }

  /**
   * The physical owner: the NodeId of the canonical incarnation's tree parent. Undefined for an ownerless
   * node, which is a Loro root, and for an id this replica never allocated. The one definition every
   * read of ownership starts from; presence decides whether a read sees it or Trash.
   */
  physicalOwner(id: NodeId): NodeId | undefined {
    const node = this.#locator.incarnations(id)[0];
    return node && parentId(node);
  }

  /**
   * The NodeIds `id` physically owns: tree children of any of its incarnations that are their own
   * NodeId's canonical incarnation. A stale incarnation left under another parent owns nothing there.
   * Tree child order carries no meaning: listings are stored apart.
   */
  ownedIds(id: NodeId): NodeId[] {
    const owned = new Set<NodeId>();
    for (const incarnation of this.#locator.incarnations(id)) {
      for (const child of incarnation.children() ?? []) {
        const childId = idOf(child);
        if (childId !== undefined && this.#locator.isCanonical(child, childId)) {
          owned.add(childId);
        }
      }
    }
    return [...owned];
  }

  /**
   * Moves every incarnation this replica sees under the canonical incarnation of `owner`, or makes them
   * roots when `owner` is undefined. Refused, writing nothing, when the owner is the node or physically
   * owned under it: incarnations created concurrently let NodeId cycles exist that no single tree move
   * would form, so the check walks NodeIds. A tree move that would still form a cycle refuses the whole
   * change when it is the canonical incarnation's, and skips that incarnation otherwise (Lode's policy
   * for a state only concurrency reaches). Returns whether it moved anything: false when refused, and
   * when every incarnation already sits there, so a caller adds no support for a change that wrote
   * nothing. Throws for a node or owner this replica never allocated.
   */
  moveOwner(id: NodeId, owner: NodeId | undefined): boolean {
    const canonical = this.#canonical(id);
    if (owner !== undefined && this.ownsOrIs(id, owner)) {
      return false;
    }
    const target = owner === undefined ? undefined : this.#canonical(owner);
    if (target !== undefined && isTreeAncestor(canonical, target)) {
      return false;
    }
    let moved = false;
    for (const incarnation of this.#locator.incarnations(id)) {
      if (incarnation.parent()?.id !== target?.id && !(target !== undefined && isTreeAncestor(incarnation, target))) {
        incarnation.move(target);
        moved = true;
      }
    }
    return moved;
  }

  /** Whether `candidate` is `id` or physically owned under it, walking NodeIds upward from `candidate`. */
  ownsOrIs(id: NodeId, candidate: NodeId): boolean {
    const seen = new Set<NodeId>();
    for (let current: NodeId | undefined = candidate; current !== undefined && !seen.has(current);) {
      if (current === id) {
        return true;
      }
      seen.add(current);
      current = this.physicalOwner(current);
    }
    return false;
  }

  #canonical(id: NodeId): LoroTreeNode {
    const node = this.#locator.incarnations(id)[0];
    if (!node) {
      throw new Error(`no node ${id}`);
    }
    return node;
  }
}

function parentId(node: LoroTreeNode): NodeId | undefined {
  const parent = node.parent();
  return parent && idOf(parent);
}

function isTreeAncestor(node: LoroTreeNode, of: LoroTreeNode): boolean {
  for (let current: LoroTreeNode | undefined = of; current !== undefined; current = current.parent()) {
    if (current.id === node.id) {
      return true;
    }
  }
  return false;
}
