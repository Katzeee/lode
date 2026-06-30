import { describe, expect, it } from "vitest";
import { createBroker, type BrokerPeer } from "./broker.js";
import { create, toBinary } from "@bufbuild/protobuf";
import { BrokerFrameSchema } from "@lode/protocol/proto";

type Delivery = { wsId: string; payload: Uint8Array };

/** A recording peer: collects delivered (wsId, payload) records. */
function recorder(id: string): { peer: BrokerPeer; delivered: Delivery[] } {
  const delivered: Delivery[] = [];
  return {
    delivered,
    peer: { id, deliver: (wsId, payload) => delivered.push({ wsId, payload }) },
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
