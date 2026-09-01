import { describe, expect, it, vi } from "vitest";

import type { SyncableComposite } from "../workspace/index.js";
import { createReplicaPeer } from "./replica-peer.js";

describe("replica peer document selection", () => {
  it("rejects a fetch for an unknown synchronization document", async () => {
    const peer = createReplicaPeer(emptyReplica());

    await expect(peer.fetch("missing", new Uint8Array())).rejects.toThrow("Unknown synchronization document: missing");
  });

  it("rejects a send for an unknown synchronization document without healing an unchanged replica", async () => {
    const heal = vi.fn(() => Promise.resolve());
    const peer = createReplicaPeer({ docs: () => [], heal });

    await expect(peer.send("missing", new Uint8Array())).rejects.toThrow("Unknown synchronization document: missing");
    expect(heal).not.toHaveBeenCalled();
  });
});

function emptyReplica(): SyncableComposite {
  return { docs: () => [], heal: () => Promise.resolve() };
}
