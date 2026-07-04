import { afterEach, describe, expect, it } from "vitest";
import { BrokerClient } from "./broker-client.js";
import { BrokerServer } from "./broker-server.js";

// Real-socket coverage for directed routing + peer discovery (design §3c). Broadcast/edge coverage
// lives in `broker-real.test.ts`; the routing-core unit cases (no sockets) in `broker.test.ts`.

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

function at(got: Delivery[], i = 0): Delivery {
  const d = got.at(i);
  if (!d) {
    throw new Error(`no delivery at ${i}`);
  }
  return d;
}

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("broker directed routing over real HTTP/2 (§3c)", () => {
  it("a directed publish reaches only the target peerId", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const a = makeClient(url);
    const b = makeClient(url);
    const c = makeClient(url);
    await Promise.all([a.client.open(), b.client.open(), c.client.open()]);
    a.client.subscribe("W", "peerA");
    b.client.subscribe("W", "peerB");
    c.client.subscribe("W", "peerC");
    await settle();

    a.client.publish("W", bytes("direct"), "peerC");

    await waitFor(() => c.got.length > 0);
    expect(Buffer.from(at(c.got).payload).toString()).toBe("direct");
    expect(a.got).toHaveLength(0); // sender never echoed
    await settle(80); // give b every chance to (not) receive
    expect(b.got).toHaveLength(0); // other subscriber not reached
  });

  it("peers() lists the declared peerIds on the channel (includes self)", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const a = makeClient(url);
    const b = makeClient(url);
    await Promise.all([a.client.open(), b.client.open()]);
    a.client.subscribe("W", "peerA");
    b.client.subscribe("W", "peerB");
    await settle();

    const list = await a.client.peers("W");
    expect(list.sort()).toEqual(["peerA", "peerB"]); // relay reports the truth; client filters self
  });

  it("a peers() query from a non-subscriber resolves empty (workspace isolation, observable)", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const a = makeClient(url);
    await a.client.open();
    // a has NOT subscribed to W → the relay answers with an empty roster (not a silent drop/timeout):
    // a non-subscriber may not learn who is on a channel it isn't in.
    await expect(a.client.peers("W")).resolves.toEqual([]);
  });

  it("a peer on ws1 cannot discover ws2's members (no cross-workspace enumeration)", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const p1 = makeClient(url);
    const p2 = makeClient(url);
    const p3 = makeClient(url);
    await Promise.all([p1.client.open(), p2.client.open(), p3.client.open()]);
    // p1+p2 share ws1; p2+p3 share ws2. p1 is NOT on ws2.
    p1.client.subscribe("ws1", "p1");
    p2.client.subscribe("ws1", "p2");
    p2.client.subscribe("ws2", "p2");
    p3.client.subscribe("ws2", "p3");
    await settle();

    const ws1 = await p1.client.peers("ws1");
    expect(ws1.sort()).toEqual(["p1", "p2"]); // own channel → full roster (incl. self; caller filters)
    const ws2 = await p1.client.peers("ws2"); // p1 is NOT subscribed to ws2
    expect(ws2).toEqual([]); // isolation: p1 must not learn p3 exists
  });

  it("a directed publish to an unknown peerId is a silent no-op (server keeps routing)", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const a = makeClient(url);
    const b = makeClient(url);
    await Promise.all([a.client.open(), b.client.open()]);
    a.client.subscribe("W", "peerA");
    b.client.subscribe("W", "peerB");
    await settle();

    a.client.publish("W", bytes("ghost"), "no-such-peer");
    await settle(80);
    expect(b.got).toHaveLength(0); // unknown target → no delivery, no throw
    // Server survived: a broadcast still reaches b.
    a.client.publish("W", bytes("real"));
    await waitFor(() => b.got.length > 0);
    expect(Buffer.from(at(b.got).payload).toString()).toBe("real");
  });
});
