// Purpose: Guards ownerless node identity through undo, redo and reopening, lookup after remote import, name undo surviving remote tree changes, and the canonical incarnation of a NodeId created concurrently.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { allocate } from "./allocate.ts";
import { nextCommandId } from "./command-id.ts";
import type { NodeId } from "./node-id.ts";
import { COMMAND } from "./origins.ts";
import { kindOf, writableFacts } from "./records.ts";
import { base, command, replica, send, sync, type Replica } from "./replicas.test-support.ts";
import { Store } from "./store.ts";
import { nameText } from "./text.ts";

const N = "N" as NodeId;
const create = (r: Replica, id: string, parent: string, kind?: "tuple") =>
  allocate(r.store, nextCommandId(r.store.doc), [{ id: id as NodeId, parent: parent as NodeId, listed: true, kind }]);

test("an ownerless node survives undo, redo and reopening as a root", () => {
  const a = replica(1n, base([{ id: "H" }, { id: "N", parent: "H" }]));
  command(a, () => a.store.ownership.moveOwner(N, undefined));
  strictEqual(a.store.ownership.physicalOwner(N), undefined);

  a.undo.undo();
  strictEqual(a.store.ownership.physicalOwner(N), "H");
  a.undo.redo();
  strictEqual(a.store.ownership.physicalOwner(N), undefined);

  const reopened = replica(2n, a.store.doc.export({ mode: "snapshot" }));
  strictEqual(reopened.store.ownership.physicalOwner(N), undefined);
});

test("a node allocated on one replica is found by NodeId on another", () => {
  const snapshot = base([{ id: "H" }]);
  const a = replica(1n, snapshot);
  const b = replica(2n, snapshot);
  create(a, "N", "H");
  send(a, b);
  strictEqual(b.store.ownership.physicalOwner(N), "H");
});

test("a name edit in a node allocated here undoes after a remote tree change arrives", () => {
  const snapshot = base([{ id: "H" }, { id: "P" }]);
  const a = replica(1n, snapshot);
  const b = replica(2n, snapshot);
  create(a, "N", "H");
  command(a, () => nameText(a.store, N).insert(0, "typed"));
  command(b, () => b.store.ownership.moveOwner("P" as NodeId, "H" as NodeId));
  send(b, a);
  a.undo.undo();
  strictEqual(nameText(a.store, N).toString(), "");
  a.undo.redo();
  strictEqual(nameText(a.store, N).toString(), "typed");
});

for (const [peerA, peerB] of [
  [9n, 10n],
  [10n, 9n],
]) {
  test(`one NodeId created on two replicas has one canonical incarnation everywhere (peers ${peerA},${peerB})`, () => {
    const snapshot = base([{ id: "I" }, { id: "Q" }]);
    const a = replica(peerA!, snapshot);
    const b = replica(peerB!, snapshot);
    create(a, "D", "I", "tuple");
    create(b, "D", "Q", "tuple");
    sync(a, b);
    const reopened = new Store(Store.newDoc());
    reopened.doc.import(a.store.doc.export({ mode: "snapshot" }));

    const D = "D" as NodeId;
    // Peer 9 sorts before peer 10 as a number, though not as text.
    const owner = peerA === 9n ? "I" : "Q";
    for (const store of [a.store, b.store, reopened]) {
      deepStrictEqual(
        [store.ownership.incarnationParents(D).length, store.ownership.physicalOwner(D), kindOf(store, D)],
        [2, owner, "tuple"],
      );
    }
  });
}

test("a fact write in a root map undoes after a remote tree operation", () => {
  const snapshot = base([{ id: "I" }, { id: "Q" }]);
  const a = replica(1n, snapshot);
  const b = replica(2n, snapshot);
  create(a, "D", "I");
  command(a, () => writableFacts(a.store, "D" as NodeId).set("description", "A wrote"));
  sync(a, b);
  create(b, "Z", "Q");
  a.store.doc.commit({ origin: COMMAND });
  sync(a, b);
  a.undo.undo();
  strictEqual(writableFacts(a.store, "D" as NodeId).get("description"), undefined);
});
