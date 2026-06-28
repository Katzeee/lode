import { LoroDoc, type VersionVector } from "loro-crdt";

/**
 * Minimal self-written stand-in for the production SyncManager exchange (see
 * `packages/engine/src/runtime/sync.ts` `exchangeDoc`). Phase 0 validates IN-PROCESS: the two
 * docs live in the same process and exchange bytes directly. Phase 1+ splits this across a real
 * process boundary; the byte-level logic stays identical, which is the point — the playground
 * isolates the transport unknowns from logic already proven here and in production truth tests.
 *
 * One round exchanges a doc both ways: each side exports its ops beyond the OTHER's version
 * vector (captured BEFORE either import), so importing never echoes a peer's own ops back.
 */
export function exchangeDocs(a: LoroDoc, b: LoroDoc): void {
  const va: VersionVector = a.version();
  const vb: VersionVector = b.version();
  const aToB = a.export({ mode: "update", from: vb });
  const bToA = b.export({ mode: "update", from: va });
  if (aToB.length > 0) {
    b.import(aToB);
  }
  if (bToA.length > 0) {
    a.import(bToA);
  }
}

/**
 * Canonical projection — the independent convergence oracle. Two LoroDocs that have exchanged
 * the same ops project to identical JSON. (Phase 0 uses `doc.toJSON()`; later phases that model
 * lode's live-id churn will switch to an occId-normalized projection, like the production
 * `tests/sync/harness.ts` `normalizeSnapshot`.)
 */
export function canonical(doc: LoroDoc): string {
  return JSON.stringify(doc.toJSON());
}
