import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateActorKeypair, generatePeerKeypair } from "../../utils/crypto/index.js";
import { WorkspaceStore } from "../../persistence/workspace-store.js";
import { MembershipLog, MEMBERSHIP_DOC_ID, type LocalPeer } from "./membership-log.js";
import {
  DocStoreMembershipPersistence,
  type MembershipPersistence,
} from "./membership-persistence.js";
import { WorkspaceDocStore } from "../workspace-doc-store.js";
import { LoroMetaDoc } from "../../core/meta-doc.js";

/** Construct a MembershipLog backed by a fresh LoroMetaDoc (the production backing). */
const newLog = (persistence?: ConstructorParameters<typeof MembershipLog>[1]): MembershipLog =>
  new MembershipLog(new LoroMetaDoc(MEMBERSHIP_DOC_ID), persistence);

const newTransitKey = (): Uint8Array => randomBytes(32);
const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
let peerCounter = 1;
const newPeerId = (): string => String(peerCounter++);
const newLocal = (): LocalPeer => ({
  actor: generateActorKeypair(),
  peer: generatePeerKeypair(),
  peerId: newPeerId(),
});
const peerPub = (local: LocalPeer) => ({
  peerId: local.peerId,
  owningActorId: local.actor.actorId,
  peerEncPub: local.peer.publicKey,
  peerName: "",
});

/** An in-memory MembershipPersistence that records every save (load returns the last save). */
function memoryPersistence(): MembershipPersistence & { saves: Uint8Array[] } {
  const saves: Uint8Array[] = [];
  return {
    saves,
    load: () => Promise.resolve(saves.at(-1) ?? null),
    save: (bytes) => {
      saves.push(bytes);
      return Promise.resolve();
    },
  };
}

async function tempWorkspaceStore(): Promise<{ store: WorkspaceStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "lode-membership-persist-"));
  const store = await WorkspaceStore.open(join(dir, "workspace.sqlite"));
  return { store, dir };
}

describe("membership log — persistence", () => {
  it("round-trips through a real WorkspaceStore: peers + transit key survive, gate skips re-bootstrap", async () => {
    const owner = newLocal();
    const member = newLocal();
    const tk = newTransitKey();
    const { store, dir } = await tempWorkspaceStore();
    try {
      // First run: append root + add, persist a deep snapshot via the DocStore port (membership is
      // a content sub-doc under its own id — no dedicated table).
      const a = newLog(
        new DocStoreMembershipPersistence(new WorkspaceDocStore(store), MEMBERSHIP_DOC_ID),
      );
      expect(await a.load()).toBe(false); // nothing persisted yet → would bootstrap
      a.appendRoot(owner, tk, "");
      a.appendAdd(owner.actor, peerPub(member), tk, 0);
      await a.persistIfDirty();

      // Second run: a fresh MembershipLog over the SAME store reloads the persisted snapshot.
      const b = newLog(
        new DocStoreMembershipPersistence(new WorkspaceDocStore(store), MEMBERSHIP_DOC_ID),
      );
      expect(await b.load()).toBe(true);
      expect(b.records().length).toBeGreaterThan(0); // the bootstrap gate (records().length === 0) would NOT fire
      const { state } = b.deriveState();
      expect(state.owner).toBe(owner.actor.actorId);
      expect([...state.peers.keys()].sort()).toEqual([member.peerId, owner.peerId].sort());
      expect(eq(b.unwrapCurrentTransitKey(state, owner), tk)).toBe(true);
      expect(eq(b.unwrapCurrentTransitKey(state, member), tk)).toBe(true);
    } finally {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persistIfDirty writes once and skips when frontiers are unchanged, then writes again on change", async () => {
    const owner = newLocal();
    const tk = newTransitKey();
    const handle = memoryPersistence();
    const log = newLog(handle);
    log.appendRoot(owner, tk, "");
    await log.persistIfDirty();
    await log.persistIfDirty(); // unchanged → no extra write
    expect(handle.saves).toHaveLength(1);
    log.appendRotate(owner.actor, [peerPub(owner)], newTransitKey(), tk, 1); // governance change
    await log.persistIfDirty();
    expect(handle.saves).toHaveLength(2);
  });

  it("after load(), persistIfDirty does not re-write the just-loaded state", async () => {
    const owner = newLocal();
    const tk = newTransitKey();
    const handle = memoryPersistence();
    const a = newLog(handle);
    a.appendRoot(owner, tk, "");
    await a.persistIfDirty();
    expect(handle.saves).toHaveLength(1);

    const b = newLog(handle);
    await b.load(); // seeds the dirty baseline from the loaded doc
    await b.persistIfDirty(); // loaded state is current → no extra write
    expect(handle.saves).toHaveLength(1);
  });

  it("without a persistence handle, load + persistIfDirty are no-ops", async () => {
    const log = newLog(); // no handle
    expect(await log.load()).toBe(false);
    await expect(log.persistIfDirty()).resolves.toBeUndefined();
  });
});
