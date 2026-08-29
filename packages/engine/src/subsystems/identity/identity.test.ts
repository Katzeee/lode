import { describe, expect, it } from "vitest";

import { InMemoryBlobStore, type BlobStore } from "../persistence/blob-store.js";
import { Identity } from "./identity.js";

const passphrase = "identity-test-passphrase";

describe("Identity", () => {
  it("keeps the in-memory vault aligned with durable state when a write fails", async () => {
    const vault = new SelectivelyFailingBlobStore([2]);
    const identity = await Identity.open({ vault, peerIdentity: new InMemoryBlobStore() });

    await expect(identity.createActor({ label: "Lost", passphrase })).rejects.toThrow("vault write failed");
    expect(identity.vaultExists()).toBe(true);
    expect(identity.listActors()).toEqual([]);

    const created = await identity.createActor({ label: "Durable", passphrase });
    const reopened = await Identity.open({ vault, peerIdentity: new InMemoryBlobStore() });
    await reopened.unlock(passphrase);
    expect(reopened.listActors()).toMatchObject([{ actorId: created.actorId, label: "Durable", unlocked: true }]);
  });

  it("serializes concurrent first-time Actor creation without losing a durable entry", async () => {
    const vault = new InMemoryBlobStore();
    const peerIdentity = new InMemoryBlobStore();
    const identity = await Identity.open({ vault, peerIdentity });

    const created = await Promise.all([
      identity.createActor({ label: "First", passphrase }),
      identity.createActor({ label: "Second", passphrase }),
    ]);

    const reopened = await Identity.open({ vault, peerIdentity });
    await reopened.unlock(passphrase);
    expect(new Set(reopened.listActors().map((actor) => actor.actorId))).toEqual(
      new Set(created.map((actor) => actor.actorId)),
    );
  });
});

class SelectivelyFailingBlobStore implements BlobStore {
  private readonly inner = new InMemoryBlobStore();
  private writes = 0;

  constructor(private readonly failingWrites: readonly number[]) {}

  read(): Promise<Uint8Array | null> {
    return this.inner.read();
  }

  write(bytes: Uint8Array): Promise<void> {
    this.writes += 1;
    return this.failingWrites.includes(this.writes)
      ? Promise.reject(new Error("vault write failed"))
      : this.inner.write(bytes);
  }
}
