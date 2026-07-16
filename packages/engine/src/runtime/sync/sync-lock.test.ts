import { describe, expect, it } from "vitest";
import { generateActorKeypair } from "../../crypto/index.js";
import { TestWorkspaceRegistry as WorkspaceRegistry } from "../../../tests/support/workspace-registry.js";
import { SyncExchange } from "./sync-exchange.js";
import type { ManagedSyncTransport, SyncProfile } from "./transport.js";

/**
 * The deterministic regression for the per-workspace loro lock wiring (design Phase 4). The
 * re-entrancy class this guards: a sync round and a client read/write touching the same loro doc.
 *
 * Old model (no lock): a sync round's `importUpdate` and a client mutation's `edit…commit` were on
 * uncoordinated paths. A mutation is an ASYNC op (it `await`s a shard fault mid-transaction); if a
 * sync round imported during that await window, loro's WASM borrow-check panicked. Driving this
 * concurrently was flaky (a race), so it was never asserted — it just hurt in production.
 *
 * New model (per-workspace RW lock): each of sync's loro stages acquires the lock; network sits
 * between stages, OUTSIDE the lock. So the test does NOT race — it uses a controllable transport
 * that parks the round mid-network (at `fetchUpdates`), and at that exact point fires a conflicting
 * client read + write. It asserts: the lock is FREE during the network phase (the client op
 * proceeds, no deadlock), and the round resumes + completes once released (no re-entrancy, no torn
 * state). Old model would re-enter here; new model queues on the lock and converges.
 */

/** A barrier the holder releases to unblock a parked operation. */
function barrier(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

/** A `SyncTransport` whose `fetchUpdates` parks at a barrier the first time it is called — modeling
 *  a network round-trip the test controls. `advertise` seeds `remoteProfile` with the tree doc so the
 *  round reaches `fetchUpdates` (a peer that never advertised the doc would skip the fetch). */
class ControllableTransport implements ManagedSyncTransport {
  private readonly fetchBlock = barrier();
  private readonly fetchReached = barrier();
  readonly sends = new Array<{ id: string; bytes: Uint8Array }>();
  private profile: SyncProfile = [];

  /** Advertise `subDocId` with `version` (a real encoded version vector — `exportUpdate` decodes it)
   *  so the round fetches it. */
  advertise(subDocId: string, version: Uint8Array): void {
    this.profile = [{ subDocId, version }];
  }

  /** Resolves once the round has parked inside `fetchUpdates` (its network phase — lock FREE). */
  reachedFetch(): Promise<void> {
    return this.fetchReached.wait;
  }

  /** Let the parked `fetchUpdates` return (resume the round's network phase). */
  releaseFetch(): void {
    this.fetchBlock.release();
  }

  remoteProfile(): Promise<SyncProfile> {
    return Promise.resolve(this.profile);
  }

  async fetchUpdates(): Promise<Uint8Array> {
    this.fetchReached.release();
    await this.fetchBlock.wait; // parked in the network phase — the workspace lock is NOT held here
    return new Uint8Array(0);
  }

  sendUpdates(subDocId: string, bytes: Uint8Array): Promise<void> {
    this.sends.push({ id: subDocId, bytes });
    return Promise.resolve();
  }

  directedFetchUpdates(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(0));
  }

  peers(): Promise<string[]> {
    return Promise.resolve([]);
  }

  open(): Promise<void> {
    return Promise.resolve();
  }

  close(): void {
    this.releaseFetch(); // never leave a parked round hanging on teardown
  }
}

describe("sync lock wiring (deterministic): a round's network phase is lock-free", () => {
  it("a client read AND write proceed while a sync round is parked mid-network; the round then completes", async () => {
    const rt = await WorkspaceRegistry.inMemory();
    const transport = new ControllableTransport();
    try {
      await rt.createWorkspace({
        workspaceId: "ws",
        displayName: "WS",
        actorKeypair: generateActorKeypair(),
      });
      // Pluck the workspace's lock + the tree doc id + a real peer version + the outliner composite
      // (the same lock run/runExclusive acquire).
      const { lock, treeId, treeVersion, composite } = await rt.runWorkspace("ws", async (w) => ({
        lock: w.lock,
        treeId: w.engine.asOutliner().treeSyncDoc().id,
        treeVersion: await w.engine.asOutliner().treeSyncDoc().version(),
        composite: w.engine.asOutliner(),
      }));
      transport.advertise(treeId, treeVersion);

      const exchange = new SyncExchange(composite, transport, lock);

      // Start the round (do NOT await yet). It runs the loro read stages, then parks in fetchUpdates.
      const round = exchange.sync();
      await transport.reachedFetch(); // round is in its NETWORK phase → the lock is FREE

      // A client WRITE during the network pause. Old model: createNode's async shard fault could
      // overlap the round's import → loro re-entrancy. New model: the lock is free here, so the
      // exclusive write acquires + completes; the round's later loro stage re-acquires after.
      let writeLanded = false;
      await rt.runWorkspaceExclusive("ws", async (w) => {
        await w.engine.createNode(null);
        writeLanded = true;
      });
      expect(writeLanded).toBe(true);

      // A client READ during the same network pause also proceeds (shared, lock free).
      const roots = await rt.runWorkspace("ws", (w) => w.engine.getRootOccurrenceIds());
      expect(roots.length).toBeGreaterThanOrEqual(1);

      // Release the network phase; the round resumes, re-acquires the lock for its remaining loro
      // stages (export/import/heal), and completes. No re-entrancy, no deadlock, no torn state — the
      // client write is reflected in the round's export (it pushed bytes for the tree).
      transport.releaseFetch();
      await expect(round).resolves.toBeDefined();
      expect(transport.sends.some((s) => s.id === treeId)).toBe(true);
    } finally {
      transport.releaseFetch(); // never leave a parked round hanging on teardown
      await rt.close();
    }
  });

  it("an importUpdate inside a shared (read) boundary throws — the import inlet is guarded", async () => {
    // The unified single-writer invariant: EVERY runtime loro write — including the importUpdate
    // inlet sync/reconcile use — is under the exclusive lock AND asserted. Importing inside a SHARED
    // boundary (writeDepth 0) must throw, proving the guard covers imports (not just engine mutators).
    const rt = await WorkspaceRegistry.inMemory();
    try {
      await rt.createWorkspace({
        workspaceId: "ws",
        displayName: "WS",
        actorKeypair: generateActorKeypair(),
      });
      // Capture the tree's export bytes under an exclusive boundary (createNode dirties the tree).
      const exportBytes = await rt.runWorkspaceExclusive("ws", async (w) => {
        await w.engine.createNode(null);
        return w.engine.asOutliner().treeSyncDoc().exportUpdate();
      });
      expect(exportBytes.length).toBeGreaterThan(0);

      // Importing those bytes inside a SHARED boundary is rejected at the inlet.
      await expect(
        rt.runWorkspace("ws", (w) => w.engine.asOutliner().treeSyncDoc().importUpdate(exportBytes)),
      ).rejects.toThrow(/read-only/);

      // The same import under an EXCLUSIVE boundary is admitted (idempotent CRDT re-import).
      await expect(
        rt.runWorkspaceExclusive("ws", (w) =>
          w.engine.asOutliner().treeSyncDoc().importUpdate(exportBytes),
        ),
      ).resolves.toBeUndefined();
    } finally {
      await rt.close();
    }
  });
});
