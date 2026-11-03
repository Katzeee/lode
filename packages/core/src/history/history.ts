// Purpose: Runs commands as single undo steps over their Loro undo items, evicts whole commands, and keeps Trash occurrences of the nodes an undone command created.

import type { UndoManager } from "loro-crdt";
import type { Graph } from "../graph/graph.ts";
import { lists } from "../graph/occurrences.ts";
import { createWriter, type Writer } from "../operations/writer.ts";
import { nextCommandId } from "../store/command-id.ts";
import { insertListing } from "../store/listings.ts";
import type { NodeId } from "../store/node-id.ts";
import { COMMAND, HISTORY } from "../store/origins.ts";
import { UNBOUNDED_UNDO_STEPS } from "../store/undo.ts";

/**
 * One command's undo step: how many Loro items Undo and Redo each consume, and the nodes it created,
 * in allocation order. The counts differ once a remote write empties an item: inverting it returns
 * false and pushes nothing, so each direction counts the pushes the other one causes.
 */
type Entry = { undo: number; redo: number; readonly created: NodeId[] };

type Direction = "undo" | "redo";

/** Loro undo items the history keeps by default; whole commands are dropped past it. */
const CAPACITY = 1000;

/**
 * The command history of one replica. A command that allocates spans several Loro undo items, since
 * an excluded commit ends the item before it; the history keeps its own stacks of whole commands, and
 * Undo or Redo consumes every item of one. Items are counted through `onPush`, which never fires for
 * an import. The created lists live on the entries, never in Loro item metadata, which loro-crdt
 * 1.17.1 misaligns once it trims past its limit.
 */
export class History {
  readonly #graph: Graph;
  readonly #manager: UndoManager;
  readonly #capacity: number;
  readonly #undoStack: Entry[] = [];
  readonly #redoStack: Entry[] = [];
  /** Whether a command, Undo or Redo runs, through its Trash commit and stack updates. */
  #busy = false;
  #counting = false;
  #pushes = 0;
  /** Items of dropped commands still at the bottom of Loro's undo stack. */
  #stale = 0;
  /** Whether Loro's limit is lowered for the running command's first push. */
  #lowered = false;

  constructor(graph: Graph, manager: UndoManager, capacity = CAPACITY) {
    this.#graph = graph;
    this.#manager = manager;
    this.#capacity = capacity;
    manager.setMaxUndoSteps(UNBOUNDED_UNDO_STEPS);
    manager.setOnPush(() => {
      if (this.#counting) {
        this.#pushes++;
      }
      // This push trimmed the stale items; a lowered limit affects only the next push.
      if (this.#lowered) {
        this.#raiseLimit();
        this.#stale = 0;
      }
      return { value: null, cursors: [] };
    });
  }

  /**
   * Runs `body` as one command and records it as one undo step when it wrote anything. A command that
   * throws is committed, counted and reverted as Undo reverts a command, Trash occurrences included,
   * so no write stays pending or leaks into the next command; like any command that wrote, it leaves
   * nothing to redo.
   */
  command<T>(body: (writer: Writer) => T): T {
    return this.#exclusive(() => this.#command(body));
  }

  #command<T>(body: (writer: Writer) => T): T {
    const { doc } = this.#graph.store;
    const command = nextCommandId(doc);
    const entry: Entry = { undo: 0, redo: 0, created: [] };
    const writer = createWriter(this.#graph, command, entry.created);
    this.#lowerLimitForStale();
    let failure: { error: unknown } | undefined;
    let result: T | undefined;
    entry.undo = this.#countPushes(() => {
      try {
        result = body(writer);
      } catch (error) {
        failure = { error };
      }
      doc.commit({ origin: COMMAND });
    });
    // A command that pushed nothing leaves the stale items for the next one.
    if (this.#lowered) {
      this.#raiseLimit();
    }
    if (failure !== undefined) {
      if (entry.undo > 0) {
        this.#invert(entry, "undo");
        this.#manager.clearRedo();
        this.#redoStack.length = 0;
      }
      throw failure.error;
    }
    if (entry.undo > 0) {
      this.#undoStack.push(entry);
      this.#redoStack.length = 0;
      this.#evict();
    }
    return result as T;
  }

  canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  /** Undoes the latest command whole; an entry whose inverse pushed nothing leaves no Redo. */
  undo(): boolean {
    return this.#exclusive(() => {
      const entry = this.#undoStack.pop();
      if (entry === undefined) {
        return false;
      }
      this.#invert(entry, "undo");
      if (entry.redo > 0) {
        this.#redoStack.push(entry);
      }
      return true;
    });
  }

  redo(): boolean {
    return this.#exclusive(() => {
      const entry = this.#redoStack.pop();
      if (entry === undefined) {
        return false;
      }
      this.#invert(entry, "redo");
      if (entry.undo > 0) {
        this.#undoStack.push(entry);
      }
      return true;
    });
  }

  /**
   * Runs one history operation alone. Pending writes would be committed into its Loro items, and a
   * call from inside another operation, such as a document subscriber notified by one of its commits,
   * would push items between that operation's items or past its stack updates; both are refused before
   * any stack changes. A subscriber's throw does not escape Loro's commit, so the outer operation
   * completes.
   */
  #exclusive<T>(operation: () => T): T {
    if (this.#busy || this.#graph.store.doc.getPendingTxnLength() > 0) {
      throw new Error("a history operation runs alone, with no other writes pending");
    }
    this.#busy = true;
    try {
      return operation();
    } finally {
      this.#busy = false;
    }
  }

  /** Runs `write` and returns how many undo items it pushed onto either stack. */
  #countPushes(write: () => void): number {
    this.#counting = true;
    this.#pushes = 0;
    try {
      write();
      return this.#pushes;
    } finally {
      this.#counting = false;
    }
  }

  /**
   * Calls Loro's inverse as often as the entry counts in `direction`, whatever each call returns, and
   * counts the pushes it causes as the opposite count. After an Undo, Trash lists what the step created.
   */
  #invert(entry: Entry, direction: Direction): void {
    const pushed = this.#countPushes(() => {
      for (let item = 0; item < entry[direction]; item++) {
        if (direction === "undo") {
          this.#manager.undo();
        } else {
          this.#manager.redo();
        }
      }
    });
    if (direction === "undo") {
      entry.redo = pushed;
      this.#listCreatedInTrash(entry.created);
    } else {
      entry.undo = pushed;
    }
  }

  /**
   * Inserts a Trash entry at the top for each created node Trash does not list, in creation order, in
   * a commit the undo manager skips, so Redo keeps it. Whether another replica's support keeps the
   * node present does not matter: another replica's Undo may still remove that support.
   */
  #listCreatedInTrash(created: readonly NodeId[]): void {
    const { store, system } = this.#graph;
    const missing = created.filter((id) => !lists(this.#graph, system.trash, id));
    for (const [index, id] of missing.entries()) {
      insertListing(store, system.trash, id, index);
    }
    store.doc.commit({ origin: HISTORY });
  }

  /**
   * Drops whole commands from the bottom until the items the history owns fit; their items become
   * stale at the bottom of Loro's stack. A command larger than the capacity goes with everything below.
   */
  #evict(): void {
    let owned = this.#ownedItems();
    while (owned > this.#capacity) {
      const dropped = this.#undoStack.shift()!;
      owned -= dropped.undo;
      this.#stale += dropped.undo;
    }
  }

  /**
   * With stale items, the next command's first push trims exactly them: Loro trims at a push, even
   * mid-command, so its limit stays unbounded except for that one push. Undo, Redo and imports never
   * trim.
   */
  #lowerLimitForStale(): void {
    if (this.#stale > 0) {
      this.#manager.setMaxUndoSteps(this.#ownedItems() + 1);
      this.#lowered = true;
    }
  }

  #raiseLimit(): void {
    this.#manager.setMaxUndoSteps(UNBOUNDED_UNDO_STEPS);
    this.#lowered = false;
  }

  #ownedItems(): number {
    return this.#undoStack.reduce((sum, entry) => sum + entry.undo, 0);
  }
}
