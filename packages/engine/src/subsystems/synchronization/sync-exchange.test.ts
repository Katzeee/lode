import { describe, expect, it } from "vitest";

import type { SyncableComposite, SyncableDoc } from "../workspace/index.js";
import { SyncExchange, type ReplicaPeer } from "./sync-exchange.js";

describe("replica exchange healing", () => {
  it("preserves both the exchange failure and the healing failure", async () => {
    const exchangeFailure = new Error("fetch failed");
    const healingFailure = new Error("heal failed");
    const document = syncableDocument();
    const composite: SyncableComposite = {
      docs: () => [document],
      heal: () => Promise.reject(healingFailure),
    };
    const peer: ReplicaPeer = {
      profile: () => Promise.resolve([{ documentId: document.id, version: new Uint8Array([1]) }]),
      fetch: () => Promise.reject(exchangeFailure),
      send: () => Promise.resolve(),
    };

    const failure = await new SyncExchange(composite, peer).sync().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({ errors: [exchangeFailure, healingFailure], cause: exchangeFailure });
  });

  it("surfaces healing failure after an otherwise successful exchange", async () => {
    const healingFailure = new Error("heal failed");
    const document = syncableDocument();
    const composite: SyncableComposite = {
      docs: () => [document],
      heal: () => Promise.reject(healingFailure),
    };
    const peer: ReplicaPeer = {
      profile: () => Promise.resolve([{ documentId: document.id, version: new Uint8Array() }]),
      fetch: () => Promise.resolve(new Uint8Array()),
      send: () => Promise.resolve(),
    };

    await expect(new SyncExchange(composite, peer).sync()).rejects.toBe(healingFailure);
  });
});

function syncableDocument(): SyncableDoc {
  return {
    id: "facts",
    version: () => Promise.resolve(new Uint8Array()),
    exportUpdate: () => Promise.resolve(new Uint8Array()),
    importUpdate: () => Promise.resolve(),
  };
}
