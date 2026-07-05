import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import { generateActorKeypair, generatePeerKeypair } from "../../utils/crypto/index.js";
import { ShardedBlockStore } from "../../core/sharded-store.js";
import { MembershipLog, type LocalPeer } from "../membership/membership-log.js";
import { BrokerServer } from "./broker-server.js";
import { BrokerSyncProtocol } from "./broker-sync-transport.js";

// Directed membership fetch (design §3c): a joiner asks ONE peer (by peerId) for the full membership
// doc, reusing the `updatesReq/Resp` + `reqId` correlation with a directed publish. This is the first
// real exercise of Phase 2's directed routing through the transport adapter.

let server: BrokerServer | undefined;
const transports: BrokerSyncProtocol[] = [];

afterEach(async () => {
  for (const t of transports) {
    t.close();
  }
  transports.length = 0;
  if (server) {
    await server.close();
    server = undefined;
  }
});

const settle = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("BrokerSyncProtocol — directed membership fetch (§3c)", () => {
  it("a joiner peers() then directed-fetches the owner's membership doc by peerId", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;

    // Owner holds a rooted membership log; the joiner holds an empty one (no root — it'll fetch it).
    const ownerLocal: LocalPeer = {
      actor: generateActorKeypair(),
      peer: generatePeerKeypair(),
      peerId: "owner",
    };
    const ownerLog = new MembershipLog(new LoroDoc(), undefined);
    await ownerLog.load();
    ownerLog.appendRoot(ownerLocal, randomBytes(32), "");
    const ownerDoc = ownerLog.toSyncDoc();

    const joinerLog = new MembershipLog(new LoroDoc(), undefined);
    await joinerLog.load();
    const joinerDoc = joinerLog.toSyncDoc();
    expect(joinerLog.records()).toHaveLength(0); // joiner starts with no root

    // The membership doc is a public doc (plaintext roster); no transit key / security needed for this
    // fetch. A ShardedBlockStore is required by the constructor; membership-only here (no content sync).
    const owner = new BrokerSyncProtocol({
      url,
      store: new ShardedBlockStore({ numShards: 4 }),
      workspaceId: "W",
      publicDocs: () => [ownerDoc],
      peerId: "owner",
    });
    const joiner = new BrokerSyncProtocol({
      url,
      store: new ShardedBlockStore({ numShards: 4 }),
      workspaceId: "W",
      publicDocs: () => [joinerDoc],
      peerId: "joiner",
    });
    transports.push(owner, joiner);
    await Promise.all([owner.open(), joiner.open()]);
    await settle(); // let both subscribes (declaring peerIds) reach the server

    // Discovery: the joiner asks who's on the channel and filters out itself.
    const peers = await joiner.peers();
    const target = peers.find((p) => p !== "joiner");
    expect(target).toBe("owner");

    // Directed fetch: ask the owner (by peerId) for the membership doc since the joiner's (empty)
    // version → the full roster.
    const bytes = await joiner.directedFetchUpdates(
      "membership",
      joinerDoc.version(),
      target as string,
    );
    expect(bytes.length).toBeGreaterThan(0);

    // Import → the joiner's log now mirrors the owner's root (it "joined" the roster).
    joinerDoc.importUpdate(bytes);
    const { state } = joinerLog.deriveState();
    expect(state.owner).toBe(ownerLocal.actor.actorId);
  });

  it("peers() excludes no one implicitly — the caller filters self (both peerIds are listed)", async () => {
    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const a = new BrokerSyncProtocol({
      url,
      store: new ShardedBlockStore({ numShards: 4 }),
      workspaceId: "W",
      peerId: "A",
    });
    const b = new BrokerSyncProtocol({
      url,
      store: new ShardedBlockStore({ numShards: 4 }),
      workspaceId: "W",
      peerId: "B",
    });
    transports.push(a, b);
    await Promise.all([a.open(), b.open()]);
    await settle();

    const fromA = await a.peers();
    expect(fromA.sort()).toEqual(["A", "B"]); // self ("A") IS listed — caller filters
  });
});
