import { describe, expect, it } from "vitest";
import { Engine } from "../../src/core/engine.js";
import { ShardedBlockStore } from "../../src/core/sharded-store.js";
import { createPlainNode } from "../../src/domain/node.js";
import { syncPair } from "../../src/runtime/sync/sync-manager.js";
import { assertConverged, cloneReplica, replica } from "./harness.js";

/**
 * Global-id uniqueness contract (the id-collision boundary). Engine nodeIds + occIds default
 * to randomUUID, so concurrent createNode on different replicas never collide. The ONLY
 * collision path is a caller injecting a generator that yields a duplicate id — a
 * caller-contract violation, not an engine bug. These pin both sides of that line.
 */

describe("id uniqueness contract", () => {
  it("default randomUUID: concurrent creates on two replicas never collide", async () => {
    const base = replica(8);
    const root = createPlainNode(base, null);
    const a = cloneReplica(base);
    const b = cloneReplica(base);
    const ax = createPlainNode(a, root.occurrenceId);
    const bx = createPlainNode(b, root.occurrenceId);

    // Independently minted ids are globally unique across the two replicas.
    expect(ax.nodeId).not.toBe(bx.nodeId);
    expect(ax.occurrenceId).not.toBe(bx.occurrenceId);

    await syncPair(a.asOutliner(), b.asOutliner());
    assertConverged([a, b], "no collision");
    // Both replicas hold both nodes, no duplicate ids in the converged state.
    expect(a.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(2);
    expect(b.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(2);
  });

  it("an injected duplicate-producing generator is the only collision path", () => {
    // Two engines share a generator that always returns the same id — a caller-contract
    // violation. Each creates one node; both end up with the same nodeId+occId.
    const fixed = () => "colliding-id";
    const a = new Engine({
      store: new ShardedBlockStore({ numShards: 8 }),
      nodeIdGenerator: fixed,
      occIdGenerator: fixed,
    });
    const b = new Engine({
      store: new ShardedBlockStore({ numShards: 8 }),
      nodeIdGenerator: fixed,
      occIdGenerator: fixed,
    });
    const na = createPlainNode(a, null);
    const nb = createPlainNode(b, null);
    // nodeId + the permanent occId both come from the duplicate generator. (occurrenceId is the
    // live Loro tree id `index@peer`, which differs per replica peer — not the permanent id.)
    expect(na.nodeId).toBe("colliding-id");
    expect(nb.nodeId).toBe("colliding-id");
    expect(na.occId).toBe("colliding-id");
    expect(nb.occId).toBe("colliding-id"); // the duplicate-occId collision the contract warns about
  });
});
