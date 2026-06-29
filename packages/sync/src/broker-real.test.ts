import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BrokerClient } from "./broker-client.js";
import { BrokerServer } from "./broker-server.js";
import { encodeFrame } from "./frame.js";

type Delivery = { wsId: string; payload: Uint8Array };

let server: BrokerServer | undefined;
const clients: BrokerClient[] = [];

afterEach(async () => {
  for (const c of clients) {
    c.close();
  }
  clients.length = 0;
  if (server) {
    await server.close();
    server = undefined;
  }
});

const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("waitFor timeout");
}

function makeClient(url: string): { client: BrokerClient; got: Delivery[] } {
  const got: Delivery[] = [];
  const client = new BrokerClient({
    url,
    onDeliver: (wsId, payload) => got.push({ wsId, payload }),
  });
  clients.push(client);
  return { client, got };
}

/** Read delivery `i` as a defined value (avoids index+non-null-assertion under noUncheckedIndexedAccess). */
function at(got: Delivery[], i = 0): Delivery {
  const d = got.at(i);
  if (!d) {
    throw new Error(`no delivery at ${i}`);
  }
  return d;
}

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("broker over real WebSocket", () => {
  it("routes a publish to a subscriber (minus sender) over a real kernel socket", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const a = makeClient(url);
    const b = makeClient(url);
    await Promise.all([a.client.open(), b.client.open()]);
    a.client.subscribe("W");
    b.client.subscribe("W");
    await settle(); // let both subscribes reach + process on the server before the publish
    a.client.publish("W", bytes("hello"));

    await waitFor(() => b.got.length > 0);
    expect(a.got).toHaveLength(0); // sender excluded
    expect(Buffer.from(at(b.got).payload).toString()).toBe("hello");
  });

  it("isolates workspaces: a client subscribed elsewhere never receives", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const a = makeClient(url);
    const b = makeClient(url);
    const c = makeClient(url); // subscribed to a DIFFERENT workspace
    await Promise.all([a.client.open(), b.client.open(), c.client.open()]);
    a.client.subscribe("W1");
    b.client.subscribe("W1");
    c.client.subscribe("W2");
    await settle();
    a.client.publish("W1", bytes("priv"));

    await waitFor(() => b.got.length > 0);
    expect(Buffer.from(at(b.got).payload).toString()).toBe("priv");
    await settle(80); // give c every chance to (not) receive
    expect(c.got).toHaveLength(0); // W2 client never sees W1 traffic
  });

  it("delivers a publish to every other subscriber (multi-recipient broadcast)", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const pub = makeClient(url);
    const m1 = makeClient(url);
    const m2 = makeClient(url);
    const m3 = makeClient(url);
    await Promise.all([pub.client.open(), m1.client.open(), m2.client.open(), m3.client.open()]);
    for (const c of [pub, m1, m2, m3]) {
      c.client.subscribe("W");
    }
    await settle();
    pub.client.publish("W", bytes("broadcast"));

    await waitFor(() => m1.got.length > 0 && m2.got.length > 0 && m3.got.length > 0);
    expect(pub.got).toHaveLength(0); // sender excluded
    for (const m of [m1, m2, m3]) {
      expect(Buffer.from(at(m.got).payload).toString()).toBe("broadcast");
    }
  });

  it("a second publish on the same workspace reaches subscribers again", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const a = makeClient(url);
    const b = makeClient(url);
    await Promise.all([a.client.open(), b.client.open()]);
    a.client.subscribe("W");
    b.client.subscribe("W");
    await settle();
    a.client.publish("W", bytes("one"));
    await waitFor(() => b.got.length === 1);
    a.client.publish("W", bytes("two"));
    await waitFor(() => b.got.length === 2);
    expect(Buffer.from(at(b.got, 0).payload).toString()).toBe("one");
    expect(Buffer.from(at(b.got, 1).payload).toString()).toBe("two");
  });

  it("does not backfill: a subscriber joining AFTER a publish receives nothing (no storage)", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const a = makeClient(url);
    await a.client.open();
    a.client.subscribe("W");
    await settle();
    a.client.publish("W", bytes("early"));
    await settle();
    // b subscribes AFTER the publish.
    const b = makeClient(url);
    await b.client.open();
    b.client.subscribe("W");
    await settle(80);
    expect(b.got).toHaveLength(0); // no storage → late subscriber gets nothing
    // ...but b receives the NEXT publish (proves the socket is alive + sub registered, not a fluke).
    a.client.publish("W", bytes("late"));
    await waitFor(() => b.got.length > 0);
    expect(Buffer.from(at(b.got).payload).toString()).toBe("late");
  });

  it("cleans up a disconnected client (no delivery to it) and keeps routing others", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const a = makeClient(url);
    const b = makeClient(url);
    await Promise.all([a.client.open(), b.client.open()]);
    a.client.subscribe("W");
    b.client.subscribe("W");
    await settle();
    b.client.close(); // disconnect b
    await settle();
    a.client.publish("W", bytes("after-close")); // {a,b} minus sender a → b gone, no crash
    await settle(80);
    expect(b.got).toHaveLength(0);
    // server still alive: a fresh client can subscribe + receive.
    const c = makeClient(url);
    await c.client.open();
    a.client.subscribe("W2");
    c.client.subscribe("W2");
    await settle();
    a.client.publish("W2", bytes("still-works"));
    await waitFor(() => c.got.length > 0);
    expect(Buffer.from(at(c.got).payload).toString()).toBe("still-works");
  });

  it("a publish before subscribing is silently dropped; the connection survives", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const a = makeClient(url);
    const b = makeClient(url);
    await Promise.all([a.client.open(), b.client.open()]);
    b.client.subscribe("W");
    await settle();
    a.client.publish("W", bytes("no-sub")); // a not subscribed → server swallows the routing-rule throw
    await settle();
    // a can now subscribe + publish normally (connection survived).
    a.client.subscribe("W");
    await settle();
    a.client.publish("W", bytes("now-subbed"));
    await waitFor(() => b.got.length > 0);
    expect(Buffer.from(at(b.got).payload).toString()).toBe("now-subbed");
  });

  it("a malformed frame from one client is dropped; others keep working (server survives)", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const a = makeClient(url);
    const b = makeClient(url);
    await Promise.all([a.client.open(), b.client.open()]);
    a.client.subscribe("W");
    b.client.subscribe("W");
    await settle();
    // A raw socket injects garbage.
    const raw = await openRaw(url);
    raw.send(Buffer.from([255, 255, 255, 0, 1, 2])); // unknown tag + oversize wsIdLen, truncated
    await settle();
    raw.close();
    // Server survived: a publishes, b receives.
    a.client.publish("W", bytes("after-garbage"));
    await waitFor(() => b.got.length > 0);
    expect(Buffer.from(at(b.got).payload).toString()).toBe("after-garbage");
  });

  it("a `deliver` frame sent by a client is ignored (no echo); the server keeps routing", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const a = makeClient(url);
    const b = makeClient(url);
    await Promise.all([a.client.open(), b.client.open()]);
    a.client.subscribe("W");
    b.client.subscribe("W");
    await settle();
    // A raw socket pretends to be the server and sends a `deliver` (clients must not originate it).
    const raw = await openRaw(url);
    raw.send(encodeFrame({ kind: "deliver", wsId: "W", payload: bytes("forged-deliver") }));
    await settle();
    expect(b.got).toHaveLength(0); // the forged deliver was ignored, not echoed to subscribers
    raw.close();
    a.client.publish("W", bytes("real"));
    await waitFor(() => b.got.length > 0);
    expect(Buffer.from(at(b.got).payload).toString()).toBe("real");
  });

  it("server.close() tears down connected clients (their sockets close)", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    // A raw client so we can read readyState directly (BrokerClient hides the socket).
    const raw = await openRaw(url);
    await server.close();
    server = undefined; // afterEach won't double-close
    await waitFor(() => raw.readyState === raw.CLOSED);
    expect(raw.readyState).toBe(raw.CLOSED);
    raw.terminate();
  });
});

/** Open a raw `ws` WebSocket to a URL (for tests that need to send arbitrary frames / read state). */
function openRaw(url: string): Promise<WebSocket> {
  const sock = new WebSocket(url);
  sock.on("error", () => {
    // never crash on a socket error during a test
  });
  return new Promise((resolve, reject) => {
    sock.once("open", () => resolve(sock));
    sock.once("error", reject);
  });
}
