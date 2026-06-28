import { LoroDoc, LoroMap, VersionVector } from "loro-crdt";
import { FrameSocket, vvEqual } from "./wire.js";
import { makeLoopbackPair } from "./socket-sync.js";

/**
 * Multi-doc sync over the wire — the playground analog of the production `SyncManager.sync()`
 * loop (`packages/engine/src/runtime/sync.ts`), but for raw `LoroDoc`s over a real socket and
 * WITHOUT the engine's `ShardedBlockStore`.
 *
 * A `DocSet` is a `Map<docId, LoroDoc>`: a "main" doc plus N content "shards". A sync round:
 *   1. PROFILE: each side announces the doc ids it holds. (The production loop derives shard ids
 *      from main's ownership map instead; TEST-MODEL property 4 establishes main-first is an
 *      optimization, not a correctness lever — an explicit profile round reaches the same union.)
 *   2. UNION: both sides compute the same sorted union of doc ids; materialize any doc they lack.
 *   3. PER-DOC EXCHANGE: for each doc id (lockstep), exchange VV + update (docId-tagged, so an
 *      update for `s3` structurally cannot land in `s7` — routing discipline).
 * Each doc is an independent CRDT with its own version vector; one round converges the full set.
 */
export type DocSet = Map<string, LoroDoc>;

/** Create a plain node modelled in the sharded shape: ownership[nodeId]=shardId in `main`, and an
 *  entity (with a `shard` field for the routing-discipline oracle) in the owning shard doc. */
export function createNode(
  set: DocSet,
  mainId: string,
  nodeId: string,
  shardId: string,
  text: string,
): void {
  let main = set.get(mainId);
  if (!main) {
    main = new LoroDoc();
    set.set(mainId, main);
  }
  main.getMap("ownership").set(nodeId, shardId);
  let shard = set.get(shardId);
  if (!shard) {
    shard = new LoroDoc();
    set.set(shardId, shard);
  }
  const entity = shard.getMap("entities").setContainer(nodeId, new LoroMap());
  entity.set("shard", shardId);
  entity.set("content", text);
}

/** Sorted canonical projection of a whole doc set: `{ docId: doc.toJSON() }` keyed by sorted id.
 *  The multi-doc convergence oracle — two converged sets project identically. */
export function canonicalDocSet(set: DocSet): string {
  const out: Record<string, unknown> = {};
  for (const id of [...set.keys()].sort()) {
    out[id] = set.get(id)!.toJSON();
  }
  return JSON.stringify(out);
}

/** Doc-id set equality (catches a shard one side failed to materialize). */
export function docIdsEqual(a: DocSet, b: DocSet): boolean {
  const ka = [...a.keys()].sort();
  const kb = [...b.keys()].sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/** Per-doc VV pointwise-equality for every shared doc id. Symmetric (size + union). */
export function docSetVVEqual(a: DocSet, b: DocSet): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const id of a.keys()) {
    const da = a.get(id);
    const db = b.get(id);
    if (!da || !db) {
      return false;
    }
    if (!vvEqual(da.version(), db.version())) {
      return false;
    }
  }
  return true;
}

/** Routing-discipline oracle: every entity in shard `sX` is a map carrying `shard === "sX"`.
 *  Catches a protocol bug that applied one shard's update bytes to another shard's doc — including
 *  corruption that landed a non-map value or a wrong shard label. */
export function routingDisciplineOk(set: DocSet): boolean {
  for (const [shardId, doc] of set) {
    if (shardId === "main") {
      continue;
    }
    const entities = doc.getMap("entities") as LoroMap;
    for (const [, entity] of entities.entries()) {
      if (!(entity instanceof LoroMap)) {
        return false; // a non-map entry is itself corruption
      }
      if (entity.get("shard") !== shardId) {
        return false;
      }
    }
  }
  return true;
}

export async function exchangeDocSetSide(
  set: DocSet,
  sock: FrameSocket,
  only?: Set<string>,
): Promise<void> {
  // 1. Announce the doc ids this side holds (always the full local set).
  sock.send({ kind: "profile", ids: [...set.keys()] });
  const peerProfile = await sock.recv();
  if (peerProfile.kind !== "profile") {
    throw new Error(`expected profile, got ${peerProfile.kind}`);
  }
  // 2. The docs to exchange this round. `only` models PARTIAL DELIVERY — "only these docs' bytes
  //    crossed the wire this round" (tunnel drop / delayed shard). Without `only`, the full union.
  //    Both sides pass the same `only`, so the union is identical and lockstep is preserved.
  const union = only ? [...only].sort() : [...new Set([...set.keys(), ...peerProfile.ids])].sort();
  // 3. Per-doc exchange.
  for (const docId of union) {
    let doc = set.get(docId);
    if (!doc) {
      doc = new LoroDoc();
      set.set(docId, doc); // materialize a doc the peer has but local hasn't
    }
    sock.send({ kind: "doc-vv", docId, vv: doc.version().encode() });
    const peerVVMsg = await sock.recv();
    if (peerVVMsg.kind !== "doc-vv" || peerVVMsg.docId !== docId) {
      throw new Error(
        `expected doc-vv for ${docId}, got ${JSON.stringify(peerVVMsg).slice(0, 80)}`,
      );
    }
    const peerVV = VersionVector.decode(peerVVMsg.vv);
    const push = doc.export({ mode: "update", from: peerVV });
    sock.send({ kind: "doc-update", docId, bytes: push });
    const pullMsg = await sock.recv();
    if (pullMsg.kind !== "doc-update" || pullMsg.docId !== docId) {
      throw new Error(`expected doc-update for ${docId}`);
    }
    if (pullMsg.bytes.length > 0) {
      doc.import(pullMsg.bytes);
    }
  }
}

/** Exchange two doc sets over a fresh real loopback TCP connection (one round, both directions).
 *  `only` restricts the round to a subset of docs — a stand-in for partial delivery (some docs'
 *  bytes dropped/delayed by the wire this round). A new connection per call — models
 *  connection/relay restart between rounds. */
export async function exchangeDocSetOverWire(
  a: DocSet,
  b: DocSet,
  only?: Set<string>,
): Promise<void> {
  const { a: sa, b: sb, close } = await makeLoopbackPair();
  try {
    await Promise.all([exchangeDocSetSide(a, sa, only), exchangeDocSetSide(b, sb, only)]);
  } finally {
    close();
  }
}

/** Conservation oracle: every nodeId recorded in `main`'s ownership map. Two converged sets have
 *  identical key sets. This catches a fault that lost a create's OWNERSHIP ENTRY. A fault that lost
 *  the shard ENTITY but not its ownership (ownership arrived, content didn't) is PENDING, not lost
 *  — caught by `canonicalDocSet` and the direct entity lookups in tests, not by this oracle.
 *  (Deletes / no-resurrection are out of scope — production's `sweepOrphans` owns that; P3 asserts
 *  only that PARTIAL DELIVERY never permanently loses a created node.) */
export function collectNodeKeys(set: DocSet, mainId = "main"): Set<string> {
  const main = set.get(mainId);
  if (!main) {
    return new Set();
  }
  return new Set([...((main.getMap("ownership") as LoroMap).keys() as string[])]);
}
