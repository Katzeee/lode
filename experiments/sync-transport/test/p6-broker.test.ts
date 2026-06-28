import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { createBroker, type Broker, type BrokerClient } from "../src/broker.js";
import { makeAesGcmCipher } from "../src/relay.js";

/**
 * P6 — the workspace-routing BROKER (design §3). Truth-based contract tests, driven only through
 * `subscribe` / `publish` and observed only through per-client received-logs + the broker's
 * voluntarily-exposed `stateSummary()` / `forwardedBytes()`. The single loudest assertion is
 * **S6.3: a private workspace's publish leaves every non-subscriber's received-log byte-identical**
 * — the property that makes this a broker, not a dumb broadcast.
 *
 * Out of scope (do NOT re-prove): CRDT convergence (P1–P3), allowlist auth (P4 — the broker is
 * no-auth), AEAD strength (P5 — reused only as a content-blindness oracle), reachability/NAT (§3a).
 * Payloads here are opaque byte blobs, not Loro updates.
 */

type RecvEntry = { wsId: string; payload: Buffer };
type TestClient = BrokerClient & {
  receivedBytes(): Buffer;
  receivedFor(wsId: string): Buffer[];
  count(): number;
};

const makeClient = (id: string): TestClient => {
  const received: RecvEntry[] = [];
  return {
    id,
    deliver: (wsId: string, payload: Uint8Array): void => {
      received.push({ wsId, payload: Buffer.from(payload) });
    },
    receivedBytes: (): Buffer => Buffer.concat(received.map((r) => r.payload)),
    receivedFor: (wsId: string): Buffer[] =>
      received.filter((r) => r.wsId === wsId).map((r) => r.payload),
    count: (): number => received.length,
  };
};

/** Wire up N named clients to a fresh broker; return { broker, clients }. */
const harness = (ids: string[]): { broker: Broker; clients: Record<string, TestClient> } => {
  const broker = createBroker();
  const clients: Record<string, TestClient> = {};
  for (const id of ids) {
    clients[id] = makeClient(id);
    broker.connect(clients[id]);
  }
  return { broker, clients };
};

const P = (s: string): Uint8Array => Buffer.from(s, "utf8");

describe("P6 workspace-routing broker", () => {
  it("S6.1 isolation + fan-out + sender-exclusion (the defining case)", () => {
    const { broker, clients } = harness(["A", "B", "C"]);
    broker.subscribe("A", "W");
    broker.subscribe("B", "W");
    broker.subscribe("C", "W2"); // C is NOT in W
    const before = {
      A: clients.A.receivedBytes(),
      B: clients.B.receivedBytes(),
      C: clients.C.receivedBytes(),
    };
    broker.publish("A", "W", P("hello"));

    expect(clients.B.count()).toBe(1); // B gained
    expect(clients.B.receivedFor("W")[0].toString("utf8")).toBe("hello");
    expect(clients.C.receivedBytes()).toStrictEqual(before.C); // isolation: C unchanged
    expect(clients.A.receivedBytes()).toStrictEqual(before.A); // sender-exclusion: A unchanged
  });

  it("S6.2 fan-out to 3+ subscribers (catches first-only / duplicate routing)", () => {
    const { broker, clients } = harness(["A", "B", "C", "D"]);
    for (const id of ["A", "B", "C", "D"]) broker.subscribe(id, "W");
    broker.publish("A", "W", P("fan"));
    // exactly N-1 = 3 of 4 received (B, C, D); sender A excluded
    expect(clients.A.count()).toBe(0);
    expect(clients.B.count()).toBe(1);
    expect(clients.C.count()).toBe(1);
    expect(clients.D.count()).toBe(1);
  });

  it("S6.3 a PRIVATE workspace never leaks to non-subscribers", () => {
    const { broker, clients } = harness(["A", "B", "C"]);
    broker.subscribe("A", "W_A"); // A's private workspace
    broker.subscribe("B", "W");
    broker.subscribe("C", "W");
    const before = {
      A: clients.A.receivedBytes(),
      B: clients.B.receivedBytes(),
      C: clients.C.receivedBytes(),
    };

    broker.publish("A", "W_A", P("private-to-A"));
    // A's private workspace traffic does NOT reach B or C (the §3 worked example).
    expect(clients.B.receivedBytes()).toStrictEqual(before.B);
    expect(clients.C.receivedBytes()).toStrictEqual(before.C);

    broker.publish("B", "W", P("shared"));
    expect(clients.C.count()).toBe(1); // C (a W subscriber) gains
    expect(clients.A.receivedBytes()).toStrictEqual(before.A); // A (not in W) still unchanged
  });

  it("S6.4 late subscriber gets subsequent publishes, not backlog (no store-and-forward)", () => {
    const { broker, clients } = harness(["A", "B", "C"]);
    broker.subscribe("A", "W");
    broker.subscribe("B", "W");
    broker.publish("A", "W", P("first"));
    expect(clients.B.count()).toBe(1);

    broker.subscribe("C", "W"); // C joins AFTER the first publish
    expect(clients.C.count()).toBe(0); // no backlog — C did not receive "first"

    broker.publish("A", "W", P("second"));
    expect(clients.C.count()).toBe(1); // C gets the next one
    expect(clients.C.receivedFor("W")[0].toString("utf8")).toBe("second");
  });

  it("S6.5 unsubscribe stops delivery; re-subscribe resumes", () => {
    const { broker, clients } = harness(["A", "B"]);
    broker.subscribe("A", "W");
    broker.subscribe("B", "W");
    broker.unsubscribe("B", "W");
    broker.publish("A", "W", P("while-unsubscribed"));
    expect(clients.B.count()).toBe(0); // unsubscribed → not delivered

    broker.subscribe("B", "W"); // re-subscribe
    broker.publish("A", "W", P("after-resubscribe"));
    expect(clients.B.count()).toBe(1);
    expect(clients.B.receivedFor("W")[0].toString("utf8")).toBe("after-resubscribe");
  });

  it("S6.6 content-blind: with an E2E cipher the broker forwards only ciphertext", () => {
    const { broker, clients } = harness(["A", "B"]);
    broker.subscribe("A", "W");
    broker.subscribe("B", "W");
    const sentinel = "SENTINEL-P6-aesgcm-9b1c";
    const key = randomBytes(32);
    const cipher = makeAesGcmCipher(key);

    broker.publish("A", "W", cipher.enc(P(sentinel)));

    // The broker forwarded ciphertext — the plaintext sentinel never appears in what it touched.
    expect(Buffer.from(broker.forwardedBytes()).includes(P(sentinel))).toBe(false);
    // B received the ciphertext and can decode it back to the sentinel (round-trip; routing intact).
    const received = clients.B.receivedFor("W")[0]!;
    expect(cipher.dec(received).includes(P(sentinel))).toBe(true);
  });

  it("S6.7 multi-workspace: a client in {W1,W2} gets per-workspace routing, no conflation", () => {
    const { broker, clients } = harness(["A", "B", "C"]);
    broker.subscribe("A", "W1");
    broker.subscribe("A", "W2");
    broker.subscribe("B", "W1");
    broker.subscribe("C", "W2");

    broker.publish("A", "W1", P("to-W1"));
    expect(clients.B.count()).toBe(1); // B (W1) gained
    expect(clients.B.receivedFor("W1")[0].toString("utf8")).toBe("to-W1");
    expect(clients.C.count()).toBe(0); // C (W2 only) did not

    broker.publish("A", "W2", P("to-W2"));
    expect(clients.C.count()).toBe(1); // C (W2) now gained
    expect(clients.C.receivedFor("W2")[0].toString("utf8")).toBe("to-W2");
    expect(clients.B.count()).toBe(1); // B (W1 only) unchanged by the W2 publish
    expect(clients.A.count()).toBe(0); // sender never receives its own publish
  });

  it("S6.8 routing table is stable across a publish session (no routing-state mutation)", () => {
    const { broker, clients } = harness(["A", "B", "C"]);
    for (const id of ["A", "B", "C"]) broker.subscribe(id, "W");
    const before = broker.stateSummary();

    broker.publish("A", "W", P("m1"));
    broker.publish("B", "W", P("m2"));
    broker.publish("A", "W", P("m3"));
    broker.publish("C", "W", P("m4"));

    const after = broker.stateSummary();
    expect(after).toStrictEqual(before); // structural state unchanged; inflight drained to 0
    expect(after.inflightBufferSize).toBe(0);
  });

  it("S6.9 sender-exclusion under fan-out (no echo to the publisher)", () => {
    const { broker, clients } = harness(["A", "B", "C"]);
    for (const id of ["A", "B", "C"]) broker.subscribe(id, "W");

    broker.publish("A", "W", P("a1"));
    expect(clients.A.count()).toBe(0); // A did not echo to itself
    expect(clients.B.count()).toBe(1);
    expect(clients.C.count()).toBe(1);

    broker.publish("B", "W", P("b1"));
    expect(clients.B.count()).toBe(1); // B did not echo to itself
    expect(clients.A.count()).toBe(1); // A (subscriber, not sender of b1) gained
    expect(clients.C.count()).toBe(2);
  });

  it("S6.10 non-subscriber publish is rejected (pinned policy: publisher must be subscribed)", () => {
    const { broker, clients } = harness(["A", "B", "C"]);
    broker.subscribe("A", "W");
    broker.subscribe("B", "W");
    // C is connected but NOT subscribed to W.
    const aBefore = clients.A.receivedBytes();
    const bBefore = clients.B.receivedBytes();

    expect(() => broker.publish("C", "W", P("sneaky"))).toThrow(/not subscribed/);
    // Rejection happened before any delivery — A and B unchanged.
    expect(clients.A.receivedBytes()).toStrictEqual(aBefore);
    expect(clients.B.receivedBytes()).toStrictEqual(bBefore);
  });

  it("disconnect removes all of a client's subscriptions", () => {
    const { broker, clients } = harness(["A", "B"]);
    broker.subscribe("A", "W1");
    broker.subscribe("A", "W2");
    broker.subscribe("B", "W1");
    broker.disconnect("A");

    // After A disconnects, A is gone from every workspace; B is now alone in W1.
    expect(broker.stateSummary().subscribers["W1"]).toEqual(["B"]);
    expect(broker.stateSummary().subscribers["W2"]).toBeUndefined();
    // B publishing to W1 routes to no one else (A gone) — and B is excluded as sender.
    expect(() => broker.publish("B", "W1", P("solo"))).not.toThrow();
  });
});
