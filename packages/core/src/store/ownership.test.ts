// Purpose: Guards owner changes over several incarnations: undo across a remote incarnation, the creation race, refusal or skipping of moves that would close a cycle, and a change that moves nothing reporting so.

import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { allocate } from "./allocate.ts";
import { nextCommandId } from "./command-id.ts";
import type { NodeId } from "./node-id.ts";
import { base, command, replica, send, sync, type Replica } from "./replicas.test-support.ts";

const [D, I, Q, X, Y, W] = ["D", "I", "Q", "X", "Y", "W"] as [NodeId, NodeId, NodeId, NodeId, NodeId, NodeId];
const create = (r: Replica, id: NodeId, parent: NodeId) =>
  allocate(r.store, nextCommandId(r.store.doc), [{ id, parent, listed: true }]);
const parents = (r: Replica, id: NodeId) => r.store.ownership.incarnationParents(id);

test("undoing an owner change returns every incarnation it moved, a remote one included", () => {
  const snapshot = base([{ id: "I" }, { id: "Q" }]);
  const a = replica(1n, snapshot);
  const b = replica(2n, snapshot);
  create(a, D, I);
  create(b, D, I);
  sync(a, b);
  command(a, () => a.store.ownership.moveOwner(D, Q));
  sync(a, b);
  deepStrictEqual(parents(b, D), [Q, Q]);
  a.undo.undo();
  sync(a, b);
  deepStrictEqual(
    [parents(a, D), parents(b, D)],
    [
      [I, I],
      [I, I],
    ],
  );
});

for (const [peerMover, peerOther] of [
  [1n, 2n],
  [2n, 1n],
]) {
  test(`an owner change racing a creation of the same NodeId resolves by the canonical incarnation, and the next change converges (mover peer ${peerMover})`, () => {
    const snapshot = base([{ id: "I" }, { id: "Q" }]);
    const mover = replica(peerMover!, snapshot);
    const other = replica(peerOther!, snapshot);
    create(mover, D, I);
    command(mover, () => mover.store.ownership.moveOwner(D, Q));
    create(other, D, I);
    sync(mover, other);
    // The mover's incarnation is canonical only when its peer is smaller; otherwise its move is lost.
    const raced = peerMover === 1n ? Q : I;
    deepStrictEqual([mover.store.ownership.physicalOwner(D), other.store.ownership.physicalOwner(D)], [raced, raced]);

    command(other, () => other.store.ownership.moveOwner(D, Q));
    sync(mover, other);
    deepStrictEqual([parents(mover, D), other.store.ownership.physicalOwner(D)], [[Q, Q], Q]);
  });
}

test("an owner change into the node's own NodeId subtree is refused by walking NodeIds from the new owner", () => {
  // W hangs under the non-canonical incarnation of X, so no tree move of X's canonical one is cyclic.
  const snapshot = base([{ id: "I" }]);
  const a = replica(1n, snapshot);
  const b = replica(2n, snapshot);
  create(a, X, I);
  create(b, X, I);
  create(b, W, X);
  sync(a, b);
  strictEqual(a.store.ownership.physicalOwner(W), X);
  const version = a.store.doc.oplogVersion().toJSON();
  deepStrictEqual([a.store.ownership.moveOwner(X, W), a.store.ownership.moveOwner(X, X)], [false, false]);
  a.store.doc.commit();
  deepStrictEqual([a.store.doc.oplogVersion().toJSON(), a.store.ownership.physicalOwner(X)], [version, I]);
});

test("a cyclic tree move of a stale incarnation is skipped, and of the canonical one refuses the change", () => {
  // B's Y sits under an X incarnation and W under that Y, while Y's canonical incarnation is A's under I.
  const skipped = (() => {
    const snapshot = base([{ id: "I" }]);
    const a = replica(1n, snapshot);
    const b = replica(2n, snapshot);
    create(a, X, I);
    create(a, Y, I);
    create(b, X, I);
    create(b, Y, X);
    create(b, W, Y);
    sync(a, b);
    const moved = a.store.ownership.moveOwner(X, W);
    a.store.doc.commit();
    return [moved, a.store.ownership.physicalOwner(X), parents(a, X)];
  })();
  deepStrictEqual(skipped, [true, W, [W, I]]);

  const refused = (() => {
    const snapshot = base([{ id: "I" }]);
    const a = replica(1n, snapshot);
    const b = replica(2n, snapshot);
    create(a, X, I);
    send(a, b);
    create(a, Y, I);
    create(b, Y, X);
    create(b, W, Y);
    sync(a, b);
    const version = a.store.doc.oplogVersion().toJSON();
    const moved = a.store.ownership.moveOwner(X, W);
    a.store.doc.commit();
    deepStrictEqual(a.store.doc.oplogVersion().toJSON(), version, "nothing written");
    return [moved, a.store.ownership.physicalOwner(X)];
  })();
  deepStrictEqual(refused, [false, I]);
});

test("an owner change that moves nothing reports so and writes nothing; an unknown node is refused", () => {
  const a = replica(1n, base([{ id: "I" }, { id: "Q" }, { id: "D", parent: "I" }]));
  const version = a.store.doc.oplogVersion().toJSON();
  strictEqual(a.store.ownership.moveOwner(D, I), false);
  a.store.doc.commit();
  deepStrictEqual(a.store.doc.oplogVersion().toJSON(), version);
  throws(() => a.store.ownership.moveOwner("missing" as NodeId, Q), /no node/);
  strictEqual(a.store.ownership.moveOwner(D, Q), true);
});
