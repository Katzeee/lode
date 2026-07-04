import { describe, expect, it } from "vitest";
import { createBroker, type BrokerPeer } from "./broker.js";
import { create, toBinary } from "@bufbuild/protobuf";
import { BrokerFrameSchema } from "@lode/protocol/proto";

type Delivery = { wsId: string; payload: Uint8Array; fromPeerId: string };

/** A recording peer: collects delivered (wsId, payload, fromPeerId) records. */
function recorder(id: string): { peer: BrokerPeer; delivered: Delivery[] } {
  const delivered: Delivery[] = [];
  return {
    delivered,
    peer: {
      id,
      deliver: (wsId, payload, fromPeerId) => delivered.push({ wsId, payload, fromPeerId }),
    },
  };
}

/** Read delivery `i` as a defined value (avoids index+non-null-assertion under noUncheckedIndexedAccess). */
function at(delivered: Delivery[], i = 0): Delivery {
  const d = delivered.at(i);
  if (!d) {
    throw new Error(`no delivery at ${i}`);
  }
  return d;
}

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("broker routing core (no sockets)", () => {
  it("routes a publish to subscribers minus the sender", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.subscribe("a", "W");
    broker.subscribe("b", "W");
    broker.publish("a", "W", bytes("hello"));

    expect(a.delivered).toHaveLength(0); // sender excluded
    expect(b.delivered).toHaveLength(1);
    expect(at(b.delivered).wsId).toBe("W");
    expect(Buffer.from(at(b.delivered).payload).toString()).toBe("hello");
  });

  it("throws when a non-subscriber publishes (routing invariant, not auth)", () => {
    const broker = createBroker();
    const a = recorder("a");
    broker.connect(a.peer);
    // a has NOT subscribed to W → publish must throw.
    expect(() => broker.publish("a", "W", new Uint8Array(0))).toThrow();
  });

  it("does not route to peers subscribed to a different workspace (content isolation)", () => {
    const broker = createBroker();
    const a = recorder("a");
    const other = recorder("o");
    broker.connect(a.peer);
    broker.connect(other.peer);
    broker.subscribe("a", "W1");
    broker.subscribe("o", "W2");
    broker.publish("a", "W1", bytes("secret"));

    expect(other.delivered).toHaveLength(0); // W2 subscriber never sees W1 traffic
    expect(a.delivered).toHaveLength(0); // sender excluded
  });

  it("stops delivery after unsubscribe", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.subscribe("a", "W");
    broker.subscribe("b", "W");
    broker.unsubscribe("b", "W");
    broker.publish("a", "W", bytes("x"));
    expect(b.delivered).toHaveLength(0);
  });

  it("disconnect removes the peer from all subscriptions", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.subscribe("a", "W");
    broker.subscribe("b", "W");
    broker.disconnect("b");
    broker.publish("a", "W", bytes("y"));
    expect(b.delivered).toHaveLength(0); // b gone — no delivery, no echo
  });

  it("is content-blind: the payload is handed through untouched (binary, any bytes)", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.subscribe("a", "W");
    broker.subscribe("b", "W");
    const opaque = new Uint8Array([0, 11, 22, 33, 0, 44]);
    broker.publish("a", "W", opaque);
    expect(Buffer.from(at(b.delivered).payload).equals(Buffer.from(opaque))).toBe(true);
  });
});

describe("broker routing core — content-blindness + edges", () => {
  it("forwards a payload that is itself a valid frame, verbatim (never recursively routed)", () => {
    // The defining §3 invariant: the broker must not interpret payload bytes. A payload shaped like a
    // publish frame is delivered byte-identical and is NOT re-routed as a second publish.
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.subscribe("a", "W");
    broker.subscribe("b", "W");
    const frameLike = toBinary(
      BrokerFrameSchema,
      create(BrokerFrameSchema, {
        kind: { case: "publish", value: { wsId: "W", payload: bytes("inner") } },
      }),
    );
    broker.publish("a", "W", frameLike);
    expect(Buffer.from(at(b.delivered).payload).equals(Buffer.from(frameLike))).toBe(true);
    expect(b.delivered).toHaveLength(1); // delivered once, not recursively routed
  });

  it("routes a publish with an empty payload", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.subscribe("a", "W");
    broker.subscribe("b", "W");
    broker.publish("a", "W", new Uint8Array(0));
    expect(b.delivered).toHaveLength(1);
    expect(at(b.delivered).payload).toHaveLength(0);
  });
});

describe("broker directed routing (§3c)", () => {
  it("routes a directed publish to only the target peerId", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    const c = recorder("c");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.connect(c.peer);
    broker.subscribe("a", "W", "peerA");
    broker.subscribe("b", "W", "peerB");
    broker.subscribe("c", "W", "peerC");

    broker.publish("a", "W", bytes("dm"), "peerC");

    expect(c.delivered).toHaveLength(1); // only the target
    expect(Buffer.from(at(c.delivered).payload).toString()).toBe("dm");
    expect(b.delivered).toHaveLength(0); // other subscriber not reached
    expect(a.delivered).toHaveLength(0); // sender never echoed
  });

  it("deliver carries the publisher's peerId as fromPeerId (so a responder can direct its reply)", () => {
    // The relay knows the publisher's peerId from the route table; it rides the deliver so the responder
    // can aim its reply at the asker (§3c directed response) instead of broadcasting.
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    const c = recorder("c");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.connect(c.peer);
    broker.subscribe("a", "W", "peerA");
    broker.subscribe("b", "W", "peerB");
    broker.subscribe("c", "W", "peerC");

    broker.publish("a", "W", bytes("directed-req"), "peerB"); // A directs a request at B
    expect(at(b.delivered).fromPeerId).toBe("peerA"); // B learns the asker is peerA

    broker.publish("a", "W", bytes("broadcast")); // A broadcasts
    expect(at(b.delivered, 1).fromPeerId).toBe("peerA");
    expect(at(c.delivered).fromPeerId).toBe("peerA");
  });

  it("deliver's fromPeerId is empty when the publisher declared no peerId (broadcast fallback)", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.subscribe("a", "W"); // broadcast-only — no peerId declared
    broker.subscribe("b", "W", "peerB");

    broker.publish("a", "W", bytes("x"));
    expect(at(b.delivered).fromPeerId).toBe(""); // responder can't direct → falls back to broadcast
  });

  it("a directed publish to an unknown peerId delivers nothing and does not throw", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.subscribe("a", "W", "peerA");
    broker.subscribe("b", "W", "peerB");

    expect(() => broker.publish("a", "W", bytes("x"), "ghost")).not.toThrow();
    expect(b.delivered).toHaveLength(0);
  });

  it("broadcast still reaches subscribers that declared no peerId (back-compat)", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.subscribe("a", "W", "peerA");
    broker.subscribe("b", "W"); // broadcast-only — not a directed target, but still receives broadcasts

    broker.publish("a", "W", bytes("all"));
    expect(b.delivered).toHaveLength(1);
    expect(a.delivered).toHaveLength(0); // sender excluded
  });

  it("peers(wsId) lists only the declared routing peerIds", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    const d = recorder("d");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.connect(d.peer);
    broker.subscribe("a", "W", "peerA");
    broker.subscribe("b", "W", "peerB");
    broker.subscribe("d", "W"); // no peerId → not directable, not listed

    expect(broker.peers("W").sort()).toEqual(["peerA", "peerB"]);
    expect(broker.peers("nope")).toEqual([]);
  });

  it("isSubscribed reports channel activeness", () => {
    const broker = createBroker();
    const a = recorder("a");
    broker.connect(a.peer);
    broker.subscribe("a", "W");
    expect(broker.isSubscribed("a", "W")).toBe(true);
    expect(broker.isSubscribed("a", "other")).toBe(false);
  });

  it("unsubscribe clears the route entry, so a directed publish to it becomes a no-op", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.subscribe("a", "W", "peerA");
    broker.subscribe("b", "W", "peerB");

    broker.unsubscribe("b", "W");
    expect(broker.peers("W")).toEqual(["peerA"]);
    broker.publish("a", "W", bytes("x"), "peerB");
    expect(b.delivered).toHaveLength(0); // b left the route table → not reached
  });

  it("disconnect clears the peer's route entries across every channel", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.subscribe("a", "W1", "peerA");
    broker.subscribe("b", "W1", "peerB");
    broker.subscribe("a", "W2", "peerA");
    broker.subscribe("b", "W2", "peerB");

    broker.disconnect("b");
    expect(broker.peers("W1")).toEqual(["peerA"]);
    expect(broker.peers("W2")).toEqual(["peerA"]);
    broker.publish("a", "W1", bytes("x"), "peerB");
    broker.publish("a", "W2", bytes("y"), "peerB");
    expect(b.delivered).toHaveLength(0);
  });

  it("two conns claiming the same peerId: last-writer-wins the route (no-auth hint)", () => {
    // peerId is a spoofable routing hint on a no-auth relay — the relay does not adjudicate ownership;
    // the latest subscriber to claim a peerId wins its route entry.
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    const c = recorder("c");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.connect(c.peer);
    broker.subscribe("a", "W", "dup");
    broker.subscribe("b", "W", "dup"); // b overwrites a's claim
    broker.subscribe("c", "W", "peerC"); // a neutral sender

    broker.publish("c", "W", bytes("z"), "dup");
    expect(b.delivered).toHaveLength(1); // latest claimant receives
    expect(a.delivered).toHaveLength(0); // shadowed by b
    expect(c.delivered).toHaveLength(0); // sender excluded
  });

  it("re-subscribing a conn with a new peerId clears the old route entry (no stale target)", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.subscribe("a", "W", "pa");
    broker.subscribe("b", "W", "pb");
    broker.subscribe("a", "W", "pa2"); // a rotates its peerId

    expect(broker.peers("W").sort()).toEqual(["pa2", "pb"]); // "pa" gone, not lingering
    broker.publish("b", "W", bytes("x"), "pa"); // old peerId no longer routes
    expect(a.delivered).toHaveLength(0);
    broker.publish("b", "W", bytes("y"), "pa2"); // new peerId routes
    expect(a.delivered).toHaveLength(1);
  });

  it("re-subscribing a conn without a peerId downgrades it out of the route table", () => {
    const broker = createBroker();
    const a = recorder("a");
    const b = recorder("b");
    broker.connect(a.peer);
    broker.connect(b.peer);
    broker.subscribe("a", "W", "pa");
    broker.subscribe("b", "W", "pb");
    broker.subscribe("a", "W"); // a drops its peerId → broadcast-only

    expect(broker.peers("W")).toEqual(["pb"]); // a no longer a directed target
  });
});
