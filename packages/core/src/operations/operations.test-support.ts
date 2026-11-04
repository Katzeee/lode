// Purpose: Builds operation test replicas forked from a genesis workspace, so the containers and definitions sit where genesis places them, and a source parent kept present only by the child an operation takes away.

import type { DocId } from "../store/doc-id.ts";
import { writeAllocation } from "../store/allocate.ts";
import { nextCommandId } from "../store/command-id.ts";
import { GENESIS } from "../store/origins.ts";
import { writeSupport } from "../store/records.ts";
import { replica } from "../store/replicas.test-support.ts";
import { Store } from "../store/store.ts";
import { genesis } from "../workspace/genesis.ts";
import { writableName } from "../graph/content.ts";
import { child, id, replicas, type Replica } from "../graph/graph.test-support.ts";
import { history, run } from "../history/history.test-support.ts";
import { sync } from "../store/replicas.test-support.ts";
import { systemNodes } from "../graph/system-nodes.ts";

const DOC = "doc" as DocId;
const BASE_PEER = 90n;

/**
 * Replicas of one genesis workspace holding `nodes` as well, each present and listed by its parent
 * unless `listed` is false; system role names such as `root` name the system nodes.
 */
export function workspace(nodes: { name: string; parent?: string; listed?: boolean }[], peers = [1n, 2n]): Replica[] {
  const doc = genesis(DOC);
  doc.setPeerId(BASE_PEER);
  const store = new Store(doc);
  const command = nextCommandId(doc);
  for (const { name, parent, listed = true } of nodes) {
    writeAllocation(store, command, [{ id: id(name), parent: parent === undefined ? undefined : id(parent), listed }]);
    writeSupport(store, id(name), command);
  }
  doc.commit({ origin: GENESIS });
  const snapshot = doc.export({ mode: "snapshot" });
  return peers.map((peer) => ({ ...replica(peer, snapshot), system: systemNodes(DOC) }));
}

/**
 * A creates P under H and N under P (P a tuple of definition F when `tuple`); B edits N; A undoes. P is
 * then present only through N, which B's edit supports. Q is a free destination.
 */
export function sourceKeptByChild(peers: bigint[], tuple: boolean): [Replica, Replica] {
  const [a, b] = replicas([{ name: "H" }, { name: "Q" }, { name: "F" }], peers) as [Replica, Replica];
  run(a, (writer) =>
    writer.create([child("P", "H", tuple ? { kind: "tuple", tupleDefinitionId: id("F") } : {}), child("N", "P")]),
  );
  sync(a, b);
  run(b, (writer) => {
    writer.touch(id("N"));
    writableName(b, id("N")).insert(0, "remote");
  });
  history(a).undo();
  sync(a, b);
  return [a, b];
}
