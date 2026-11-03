// Purpose: Runs test commands through one command history per test replica.

import type { Replica } from "../graph/graph.test-support.ts";
import type { Writer } from "../operations/writer.ts";
import { History } from "./history.ts";

const histories = new WeakMap<Replica, History>();

/** The replica's command history, installed on its undo manager the first time it is asked for. */
export function history(r: Replica, capacity?: number): History {
  let found = histories.get(r);
  if (found === undefined) {
    found = new History(r, r.undo, capacity);
    histories.set(r, found);
  }
  return found;
}

/** Runs `body` as one command of the replica's history. */
export function run<T>(r: Replica, body: (writer: Writer) => T): T {
  return history(r).command(body);
}
