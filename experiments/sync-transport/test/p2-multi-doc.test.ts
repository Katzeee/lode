import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import {
  canonicalDocSet,
  createNode,
  docIdsEqual,
  docSetVVEqual,
  exchangeDocSetOverWire,
  routingDisciplineOk,
  type DocSet,
} from "../src/multi-sync.js";

/**
 * P2 — multi-doc (treeDoc + shards) convergence over the wire. A `DocSet` (main + N shards, each
 * an independent LoroDoc with its own VV) syncs via a profile-union + per-doc exchange over a real
 * loopback TCP connection. This is the transport analog of the production `SyncManager.sync()`
 * loop. Truth-based oracles (per TEST-MODEL.md §P2): full-set convergence, doc-id-set equality,
 * per-doc VV equality, routing discipline.
 */

const newDocSet = (): DocSet => new Map();

describe("P2 multi-doc (main + shards) over the wire", () => {
  it("S2.1 asymmetric shard knowledge → B gains A's shards, all converge", async () => {
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "n1", "s1", "in-s1");
    createNode(a, "main", "n3", "s3", "in-s3");
    b.set("main", new LoroDoc()); // B has only main (no ownership, no shards)
    expect(docIdsEqual(a, b)).toBe(false);

    await exchangeDocSetOverWire(a, b);

    expect(docIdsEqual(a, b)).toBe(true); // B materialized s1, s3
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b)); // full-set convergence
    expect(docSetVVEqual(a, b)).toBe(true); // per-doc VV equality
    expect(routingDisciplineOk(a) && routingDisciplineOk(b)).toBe(true);
    expect([...b.keys()].sort()).toEqual(["main", "s1", "s3"]);
  });

  it("S2.2 disjoint shard ownership → both gain all shards, converge", async () => {
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "a1", "s1", "A-s1");
    createNode(a, "main", "a2", "s2", "A-s2");
    createNode(b, "main", "b3", "s3", "B-s3");
    createNode(b, "main", "b4", "s4", "B-s4");

    await exchangeDocSetOverWire(a, b);

    expect([...a.keys()].sort()).toEqual(["main", "s1", "s2", "s3", "s4"]);
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));
    expect(docSetVVEqual(a, b)).toBe(true);
    // conservation: A's nodes reached B, B's nodes reached A, each in its owning shard
    expect(b.get("s1")!.getMap("entities").get("a1")).toBeDefined();
    expect(b.get("s2")!.getMap("entities").get("a2")).toBeDefined();
    expect(a.get("s3")!.getMap("entities").get("b3")).toBeDefined();
    expect(a.get("s4")!.getMap("entities").get("b4")).toBeDefined();
    expect(routingDisciplineOk(a) && routingDisciplineOk(b)).toBe(true);
  });

  it("S2.3 a shard created in a LATER round is discovered + synced", async () => {
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "n1", "s1", "first");
    await exchangeDocSetOverWire(a, b); // round 1: B gains main + s1
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));

    createNode(a, "main", "n5", "s5", "second"); // A opens a brand-new shard s5
    expect(b.has("s5")).toBe(false);

    await exchangeDocSetOverWire(a, b); // round 2: B discovers s5 via A's profile
    expect(b.has("s5")).toBe(true);
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));
    expect(docSetVVEqual(a, b)).toBe(true);
  });

  it("S2.4 many shards → full-set converge, none dropped", async () => {
    const a = newDocSet();
    const b = newDocSet();
    for (let i = 0; i < 50; i++) {
      createNode(a, "main", `n${i}`, `s${i}`, `content-${i}`);
    }
    await exchangeDocSetOverWire(a, b);

    expect(docIdsEqual(a, b)).toBe(true);
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));
    expect(docSetVVEqual(a, b)).toBe(true);
    expect(routingDisciplineOk(b)).toBe(true);
    for (let i = 0; i < 50; i++) {
      expect(b.get(`s${i}`)!.getMap("entities").get(`n${i}`)).toBeDefined();
    }
  });

  it("S2.5 re-round after a single-shard edit converges; unedited shards unchanged", async () => {
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "n1", "s1", "x");
    createNode(a, "main", "n2", "s2", "y");
    await exchangeDocSetOverWire(a, b);
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));

    const s2Before = b.get("s2")!.toJSON();
    createNode(a, "main", "n1b", "s1", "edited-s1"); // A edits ONLY shard s1
    await exchangeDocSetOverWire(a, b); // re-round

    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b)); // converged
    expect(docSetVVEqual(a, b)).toBe(true);
    expect(b.get("s2")!.toJSON()).toStrictEqual(s2Before); // unedited shard untouched
    expect(b.get("s1")!.getMap("entities").get("n1b")).toBeDefined(); // the s1 edit arrived
  });

  it("routing discipline: every entity lives in its labelled shard (no cross-doc corruption)", async () => {
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "x", "s1", "c-x");
    createNode(a, "main", "y", "s1", "c-y");
    createNode(a, "main", "z", "s2", "c-z");
    createNode(a, "main", "w", "s3", "c-w");

    await exchangeDocSetOverWire(a, b);

    for (const set of [a, b]) {
      expect(routingDisciplineOk(set)).toBe(true);
    }
    // z is in s2, never s1 — the docId-tagged protocol cannot misroute it
    expect(b.get("s2")!.getMap("entities").get("z")).toBeDefined();
    expect(b.get("s1")!.getMap("entities").get("z")).toBeUndefined();
  });

  it("empty profile: both sides start with no docs → no-op converge", async () => {
    const a = newDocSet();
    const b = newDocSet();
    await exchangeDocSetOverWire(a, b);
    expect(docIdsEqual(a, b)).toBe(true);
    expect(a.size).toBe(0);
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));
  });

  it("3-peer transitivity: a pairwise sync chain converges all to one state", async () => {
    const a = newDocSet();
    const b = newDocSet();
    const c = newDocSet();
    createNode(a, "main", "n1", "s1", "x");
    createNode(a, "main", "n2", "s2", "y");

    await exchangeDocSetOverWire(a, b); // A→B
    await exchangeDocSetOverWire(b, c); // B→C (C gets A's data via B, never directly so far)
    await exchangeDocSetOverWire(a, c); // A→C direct

    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));
    expect(canonicalDocSet(b)).toBe(canonicalDocSet(c));
    expect(docSetVVEqual(a, c)).toBe(true);
    expect(routingDisciplineOk(c)).toBe(true);
  });
});
