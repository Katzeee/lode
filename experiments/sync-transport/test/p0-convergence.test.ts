import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import { canonical, exchangeDocs } from "../src/sync.js";

/**
 * P0 — in-process stand-in. Proves the Loro exchange primitives converge BEFORE splitting across
 * a process boundary, and establishes the harness + oracle. These are NOT re-proving CRDT
 * semantics (covered by production `@lode/engine` truth tests); they pin the stand-in exchange
 * loop itself so Phase 1+ can isolate transport-only failures.
 */

describe("P0 in-process stand-in: Loro exchange converges", () => {
  it("one-way edit then exchange converges both docs (convergence + conservation)", () => {
    const a = new LoroDoc();
    const b = new LoroDoc();
    a.getText("t").insert(0, "hello");
    a.getMap("m").set("k", 1);
    expect(canonical(a)).not.toBe(canonical(b));

    exchangeDocs(a, b);

    expect(canonical(a)).toBe(canonical(b)); // convergence
    expect(b.getText("t").toString()).toBe("hello"); // conservation: text survived
    expect(b.getMap("m").get("k")).toBe(1); // conservation: map entry survived
  });

  it("concurrent edits on both sides merge to ONE converged state", () => {
    const a = new LoroDoc();
    const b = new LoroDoc();
    exchangeDocs(a, b); // common (empty) base
    a.getText("t").insert(0, "A");
    b.getText("t").insert(0, "B");

    exchangeDocs(a, b);

    // Loro text is a sequence CRDT → concurrent edits merge; the merged value is Loro-defined,
    // not spec-pinnable. The truth we assert independently is CONVERGENCE (identical state).
    expect(canonical(a)).toBe(canonical(b));
    expect(a.getText("t").toString()).toBe(b.getText("t").toString());
  });

  it("idempotent re-exchange changes neither state nor version (determinism)", () => {
    const a = new LoroDoc();
    const b = new LoroDoc();
    a.getMap("m").set("x", 1);
    b.getMap("m").set("y", 2);
    exchangeDocs(a, b);

    const stateBefore = canonical(a);
    const vv = (d: LoroDoc): string => JSON.stringify(d.version());
    const va = vv(a);
    const vb = vv(b);

    exchangeDocs(a, b); // again — nothing new to exchange

    expect(canonical(a)).toBe(stateBefore);
    expect(canonical(b)).toBe(stateBefore);
    expect(vv(a)).toBe(va);
    expect(vv(b)).toBe(vb);
  });

  it("repeated divergence→exchange over many rounds stays converged", () => {
    const a = new LoroDoc();
    const b = new LoroDoc();
    for (let round = 0; round < 10; round++) {
      a.getMap("m").set(`a${round}`, round);
      b.getMap("m").set(`b${round}`, round * 2);
      exchangeDocs(a, b);
      expect(canonical(a)).toBe(canonical(b));
    }
    // every key from both sides is present on both (conservation across rounds)
    for (let round = 0; round < 10; round++) {
      expect(a.getMap("m").get(`a${round}`)).toBe(round);
      expect(a.getMap("m").get(`b${round}`)).toBe(round * 2);
    }
  });
});
