import { describe, expect, it } from "vitest";
import {
  canonicalDocSet,
  collectNodeKeys,
  createNode,
  docSetVVEqual,
  exchangeDocSetOverWire,
  type DocSet,
} from "../src/multi-sync.js";

/**
 * P3 — reconnect / partial-delivery self-heal. The wire is modelled as UNRELIABLE via the `only`
 * option to `exchangeDocSetOverWire`: a round with `only` delivers just that subset of docs
 * (stand-in for "tunnel dropped the rest" / "shard delayed"). A subsequent FULL round heals.
 *
 * This is OUTCOME-LEVEL fault injection: the CRDT self-heal properties (eventual convergence,
 * conservation, idempotence) don't depend on WHY bytes failed to arrive, only that they arrive
 * eventually — so subset-delivery validates the same properties as byte-stream faults. (Socket-level
 * fault injection / FrameSocket robustness is a separate, deferred concern.) Production's
 * `sweepOrphans` no-resurrection algorithm is OUT OF SCOPE (the playground carries no sweep); P3
 * asserts only that partial delivery never permanently loses a created node.
 */

const newDocSet = (): DocSet => new Map();
const only = (...ids: string[]): Set<string> => new Set(ids);

describe("P3 partial-delivery + reconnect self-heal", () => {
  it("S3.1 only `main` crosses round 1 → B pending → full round heals (conservation)", async () => {
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "n1", "s1", "x");
    createNode(a, "main", "n3", "s3", "z");

    await exchangeDocSetOverWire(a, b, only("main")); // tunnel dropped everything but main

    // PENDING state: B has main (ownership traveled with it) but NOT the shards it references.
    expect(b.has("s1")).toBe(false);
    expect(b.has("s3")).toBe(false);
    expect(b.get("main")!.getMap("ownership").get("n1")).toBe("s1"); // ownership is in main
    expect(canonicalDocSet(a)).not.toBe(canonicalDocSet(b)); // diverged

    await exchangeDocSetOverWire(a, b); // reconnect → full round heals

    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));
    expect(docSetVVEqual(a, b)).toBe(true);
    expect([...collectNodeKeys(b)].sort()).toEqual(["n1", "n3"]); // nothing lost
    expect(b.get("s1")!.getMap("entities").get("n1")).toBeDefined();
    expect(b.get("s3")!.getMap("entities").get("n3")).toBeDefined();
  });

  it("S3.2 some shards delayed → pending on the rest → heal", async () => {
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "n1", "s1", "x");
    createNode(a, "main", "n2", "s2", "y");

    await exchangeDocSetOverWire(a, b, only("main", "s1")); // s1 arrived, s2 delayed

    expect(b.get("s1")!.getMap("entities").get("n1")).toBeDefined(); // s1 content present
    expect(b.has("s2")).toBe(false); // s2 still pending
    expect(canonicalDocSet(a)).not.toBe(canonicalDocSet(b));

    await exchangeDocSetOverWire(a, b); // s2 arrives → heal
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));
    expect(docSetVVEqual(a, b)).toBe(true);
    expect(b.get("s2")!.getMap("entities").get("n2")).toBeDefined();
    expect([...collectNodeKeys(b)].sort()).toEqual(["n1", "n2"]);
  });

  it("S3.3 three peers: a partitioned peer reconnects and converges (transitivity)", async () => {
    const a = newDocSet();
    const b = newDocSet(); // partitioned initially
    const c = newDocSet();
    createNode(a, "main", "n1", "s1", "x");

    await exchangeDocSetOverWire(a, c); // A↔C converge while B is partitioned
    createNode(b, "main", "n2", "s2", "y"); // B creates locally, offline
    createNode(a, "main", "n3", "s3", "z"); // A keeps editing

    // B reconnects: sync with A, then propagation via B to C, then A↔C top-up.
    await exchangeDocSetOverWire(a, b);
    await exchangeDocSetOverWire(b, c);
    await exchangeDocSetOverWire(a, c);

    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));
    expect(canonicalDocSet(b)).toBe(canonicalDocSet(c));
    expect(docSetVVEqual(a, c)).toBe(true);
    // every partition-time create survived on all three peers
    for (const set of [a, b, c]) {
      expect([...collectNodeKeys(set)].sort()).toEqual(["n1", "n2", "n3"]);
    }
  });

  it("S3.5 stale re-delivery (lost ACK) is idempotent — re-exchange changes nothing", async () => {
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "n1", "s1", "x");
    createNode(a, "main", "n2", "s2", "y");
    await exchangeDocSetOverWire(a, b);
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));

    const stateBefore = canonicalDocSet(b);
    const vb = b.get("s1")!.version().encode();

    await exchangeDocSetOverWire(a, b); // stale re-send (peer already has it)
    await exchangeDocSetOverWire(a, b);

    expect(canonicalDocSet(b)).toBe(stateBefore); // no-op
    expect(b.get("s1")!.version().encode()).toEqual(vb); // VV didn't move
  });

  it("S3.7 flaky wire: incremental partial rounds still eventually converge + conserve", async () => {
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "n1", "s1", "x");
    createNode(a, "main", "n2", "s2", "y");
    createNode(a, "main", "n3", "s3", "z");

    await exchangeDocSetOverWire(a, b, only("main")); // only main
    expect(canonicalDocSet(a)).not.toBe(canonicalDocSet(b));
    await exchangeDocSetOverWire(a, b, only("main", "s1")); // + s1
    await exchangeDocSetOverWire(a, b, only("main", "s1", "s2")); // + s2 (s3 still missing)
    expect(b.has("s3")).toBe(false);

    await exchangeDocSetOverWire(a, b); // full round — heals the last gap
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));
    expect(docSetVVEqual(a, b)).toBe(true);
    expect([...collectNodeKeys(b)].sort()).toEqual(["n1", "n2", "n3"]); // nothing lost across flaps
  });

  it("heal from a pending ownership-reference converges without error", async () => {
    // Production mid-sync contract (read side owned by `mid-sync-read.test.ts`): a node whose
    // ownership arrived (in main) but whose content shard hasn't is PENDING, not corrupt. The
    // playground models the HEAL side: B holds ownership for a missing shard, then a later round
    // delivers it without error or loss. (The playground has no read path that would throw on a
    // pending shard, so this validates heal-convergence, not mid-sync read safety.)
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "n1", "s1", "x");
    await exchangeDocSetOverWire(a, b, only("main"));

    // B's main references s1 which B does not hold — pending, not an error state.
    expect(b.get("main")!.getMap("ownership").get("n1")).toBe("s1");
    expect(b.has("s1")).toBe(false);

    await expect(exchangeDocSetOverWire(a, b)).resolves.toBeUndefined(); // heal does not throw
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));
    expect(b.get("s1")!.getMap("entities").get("n1")).toBeDefined();
  });
});
