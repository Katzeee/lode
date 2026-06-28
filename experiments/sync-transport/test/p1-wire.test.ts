import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import { canonical } from "../src/sync.js";
import { exchangeOverWire } from "../src/socket-sync.js";
import { vvEqual } from "../src/wire.js";

/**
 * P1 — real wire convergence. Two LoroDoc's exchange over a real loopback TCP connection
 * (framed binary, Loro-native VV encode/decode). This is the fundamental transport unknown:
 * does Loro update/VV round-trip through socket serialization and converge?
 *
 * Truth-based, transport-agnostic oracles (per TEST-MODEL.md §P1): content convergence (canonical
 * projection), VV pointwise-equality, idempotent re-sync, snapshot-vs-update equivalence. These do
 * NOT re-prove CRDT semantics (production truth tests own that) — only that the WIRE preserves them.
 */

describe("P1 real-wire convergence (loopback TCP)", () => {
  it("S1.1 one-way edit over the wire converges + VVs equal (convergence + conservation)", async () => {
    const a = new LoroDoc();
    const b = new LoroDoc();
    a.getText("t").insert(0, "hello-wire");
    a.getMap("m").set("k", 42);
    expect(canonical(a)).not.toBe(canonical(b));

    await exchangeOverWire(a, b);

    expect(canonical(a)).toBe(canonical(b)); // content convergence across the wire
    expect(b.getText("t").toString()).toBe("hello-wire");
    expect(b.getMap("m").get("k")).toBe(42);
    expect(vvEqual(a.version(), b.version())).toBe(true); // VV pointwise-equal
  });

  it("S1.2 concurrent divergent edits merge to ONE converged state across the wire", async () => {
    const a = new LoroDoc();
    const b = new LoroDoc();
    await exchangeOverWire(a, b); // common empty base
    a.getText("t").insert(0, "A");
    b.getText("t").insert(0, "B");

    await exchangeOverWire(a, b);

    // Loro merges concurrent text edits; the merged value is Loro-defined. Truth = both peers hold
    // the SAME merged value + converged VVs.
    expect(canonical(a)).toBe(canonical(b));
    expect(a.getText("t").toString()).toBe(b.getText("t").toString());
    expect(vvEqual(a.version(), b.version())).toBe(true);
  });

  it("S1.3 large update over the wire converges + byte-conservation (sent === received)", async () => {
    const a = new LoroDoc();
    const b = new LoroDoc();
    const m = a.getMap("data");
    for (let i = 0; i < 2000; i++) {
      m.set(`k${i}`, i);
    }
    const stats = await exchangeOverWire(a, b);

    expect(canonical(a)).toBe(canonical(b));
    expect(vvEqual(a.version(), b.version())).toBe(true);
    // byte-conservation oracle: the Loro update payload A pushed is exactly the length B received
    // — the wire neither padded, truncated, fused, nor re-chunked the bytes. (Convergence alone
    // would not catch a compensating re-chunk; this asserts the wire preserved the payload.)
    expect(stats.a.sentUpdateLen).toBe(stats.b.recvUpdateLen);
    expect(stats.b.sentUpdateLen).toBe(stats.a.recvUpdateLen);
    for (let i = 0; i < 2000; i++) {
      expect(b.getMap("data").get(`k${i}`)).toBe(i); // every entry survived the wire
    }
  });

  it("S1.4 snapshot bootstrap then incremental update converges to the same state", async () => {
    const a = new LoroDoc();
    a.getMap("m").set("x", 1);
    a.getText("t").insert(0, "first");
    // B bootstraps from a SNAPSHOT (not incremental updates) of a's current state.
    const b = new LoroDoc();
    b.import(a.export({ mode: "snapshot" }));
    expect(canonical(b)).toBe(canonical(a));

    // a keeps editing; an incremental wire round brings b to a's new state.
    a.getMap("m").set("y", 2);
    await exchangeOverWire(a, b);
    expect(canonical(b)).toBe(canonical(a));
    expect(vvEqual(a.version(), b.version())).toBe(true);
  });

  it("S1.5 bidirectional both-dirty then idempotent re-sync (catches an echo bug)", async () => {
    const a = new LoroDoc();
    const b = new LoroDoc();
    await exchangeOverWire(a, b);
    a.getMap("m").set("a", true);
    b.getMap("m").set("b", true);

    await exchangeOverWire(a, b);
    expect(canonical(a)).toBe(canonical(b));
    const stateAfter = canonical(a);
    const va = a.version();
    const vb = b.version();

    await exchangeOverWire(a, b); // re-sync — must be a no-op
    await exchangeOverWire(a, b); // and again, for good measure

    expect(canonical(a)).toBe(stateAfter);
    expect(canonical(b)).toBe(stateAfter);
    expect(vvEqual(a.version(), va)).toBe(true);
    expect(vvEqual(b.version(), vb)).toBe(true);
  });

  it("S1.6 fresh connection between rounds (relay/connection restart) still converges", async () => {
    const a = new LoroDoc();
    const b = new LoroDoc();
    a.getMap("m").set("round1", true);
    await exchangeOverWire(a, b); // connection 1
    expect(canonical(a)).toBe(canonical(b));

    b.getMap("m").set("round2", true);
    // exchangeOverWire opens a NEW loopback pair each call — models a relay/connection restart.
    await exchangeOverWire(a, b); // connection 2 (stateless relay: restart loses nothing)
    expect(canonical(a)).toBe(canonical(b));
    expect(a.getMap("m").get("round1")).toBe(true);
    expect(a.getMap("m").get("round2")).toBe(true);
    expect(vvEqual(a.version(), b.version())).toBe(true);
  });
});
