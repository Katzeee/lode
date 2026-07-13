import { describe, expect, it } from "vitest";
import { createPlainNode } from "../../src/domain/node/node.js";
import { replica, syncTreeOnly } from "./harness.js";

/**
 * Mid-partial-sync read contract (characterization). After only the treeDoc ("main") is
 * exchanged, a replica has a node's ownership but not its content shard — a pending-shard
 * state that self-heals once the shard arrives. Reading such a node must throw rather than
 * silently return empty/partial data: sync is synchronous today (reads never interleave a
 * half-delivered node), and this throw is the gate real network transport must
 * respect — never surface a node for reading before its owning shard has landed.
 */
describe("sync mid-partial-sync read contract", () => {
  it("a node whose content shard has not arrived throws on read (not silent partial)", async () => {
    const a = replica(8);
    const root = await a.createNode(null);
    const child = await createPlainNode(a, root.occurrenceId);

    const b = replica(8); // fresh, empty
    await syncTreeOnly(a, b); // treeDoc only: ownership arrives, the content shard does NOT

    // Ownership arrived via the treeDoc, so the node is structurally known; its content shard
    // was never delivered → the read is undefined and must throw.
    await expect(b.getOccurrences(child.nodeId)).rejects.toThrow(/entity not found/);
  });

  it("once the missing shard is delivered the read succeeds (self-heal)", async () => {
    const { syncPair } = await import("../../src/runtime/sync/sync-exchange.js");
    const a = replica(8);
    const root = await a.createNode(null);
    const child = await createPlainNode(a, root.occurrenceId);

    const b = replica(8);
    await syncTreeOnly(a, b);
    await expect(b.getOccurrences(child.nodeId)).rejects.toThrow(/entity not found/);

    // A full sync delivers the shard; the pending read now resolves.
    await syncPair(a.asOutliner(), b.asOutliner());
    expect((await b.getOccurrences(child.nodeId)).map((o) => o.occurrenceId)).toContain(
      child.occurrenceId,
    );
  });
});
