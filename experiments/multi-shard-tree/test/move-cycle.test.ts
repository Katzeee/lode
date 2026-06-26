import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { SingleDocEngine } from "../src/single-doc-engine.js";

/**
 * Finding 1 — cycle-forming moves.
 *
 * LoroTree's `move` throws `Movable Tree Error: Cycle move` on a cycle-forming
 * move. That error is delivered BOTH synchronously (catchable) AND as an uncaught
 * exception that kills a long-running host (verified: the daemon/vitest process is
 * torn down even with try/catch; only a process that exits immediately can race
 * past it). This is a Loro-level limitation, NOT sharding-specific — the
 * single-doc oracle (production `LoroBlockStore` shape) has the identical behavior,
 * so production today is equally exposed.
 *
 * The engine now PRE-CHECKS the move and rejects a cycle with a clean, catchable
 * Error BEFORE touching Loro, so a local cycle move can no longer crash the host.
 * (The residual hazard — two replicas making individually-valid moves that form a
 * cycle only on merge — lives inside Loro's import and cannot be engine-guarded;
 * see the README limitation note.)
 */

const canon = (e: ShardedEngine | SingleDocEngine, n: string): string =>
  e.snapshot().nodes[n]!.canonicalOccurrenceId;

/** root → A → B (A is an ancestor of B). */
const buildChain = (
  Eng: new () => ShardedEngine | SingleDocEngine,
): ShardedEngine | SingleDocEngine => {
  const e = new Eng();
  const root = e.createNode("root", null);
  e.createNode("A", root);
  e.createNode("B", canon(e, "A"));
  e.commit();
  return e;
};

for (const Engine of [ShardedEngine, SingleDocEngine]) {
  const name = Engine === ShardedEngine ? "ShardedEngine" : "SingleDocEngine (oracle)";

  describe(`cycle guard: ${name}`, () => {
    it("moving an ANCESTOR under its DESCENDANT throws a clean cycle error (no crash)", () => {
      const e = buildChain(Engine as never);
      // If the guard were absent, this triggers Loro's fatal Cycle-move abort.
      expect(() => e.moveOccurrence(canon(e, "A"), canon(e, "B"))).toThrow(/cycle/i);
      // The process is still alive (this line runs); invariants still hold.
      e.validateInvariants();
    });

    it("moving an occurrence under ITSELF throws a cycle error", () => {
      const e = buildChain(Engine as never);
      expect(() => e.moveOccurrence(canon(e, "A"), canon(e, "A"))).toThrow(/cycle/i);
      e.validateInvariants();
    });

    it("a NON-cycle move still applies (guard does not over-reject)", () => {
      const e = buildChain(Engine as never);
      // Move B (leaf) under root — B is not an ancestor of root, fine.
      e.moveOccurrence(canon(e, "B"), canon(e, "root"));
      e.commit();
      e.validateInvariants();
      expect(e.snapshot().occurrences[canon(e, "B")]?.parentOccurrenceId).toBe(canon(e, "root"));
    });

    it("moving a subtree under an unrelated sibling is allowed", () => {
      const e = new Engine();
      const root = e.createNode("root", null);
      e.createNode("A", root);
      e.createNode("C", root); // sibling of A
      e.commit();
      e.moveOccurrence(canon(e, "A"), canon(e, "C")); // A under C — no cycle
      e.commit();
      e.validateInvariants();
    });
  });
}

describe("cycle guard: sharded ≡ oracle (equivalent rejection)", () => {
  it("both engines reject the same cycle move and accept the same valid move", () => {
    const a = buildChain(ShardedEngine);
    const b = buildChain(SingleDocEngine);
    expect(() => a.moveOccurrence(canon(a, "A"), canon(a, "B"))).toThrow(/cycle/i);
    expect(() => b.moveOccurrence(canon(b, "A"), canon(b, "B"))).toThrow(/cycle/i);
    // Same valid move accepted on both.
    a.moveOccurrence(canon(a, "B"), canon(a, "root"));
    b.moveOccurrence(canon(b, "B"), canon(b, "root"));
    a.commit();
    b.commit();
    a.validateInvariants();
    b.validateInvariants();
  });
});
