import { describe, expect, it } from "vitest";
import { allowlistOf, newIdentity, type Identity } from "../src/identity.js";
import { exchangeGatedOverWire as gated } from "../src/gated-sync.js";
import { canonicalDocSet, createNode, type DocSet } from "../src/multi-sync.js";

/**
 * P4 — pubkey allowlist / membership gating. A membership gate (Ed25519 auth handshake +
 * per-workspace pubkey allowlist) wraps the transport: only allowlist members can exchange, and a
 * rejection happens BEFORE any doc bytes cross. This is the design's egalitarian model (§4, §6):
 * no admin, no roles; binary membership; revocation = a member drops the peer's pubkey.
 *
 * Oracles (per TEST-MODEL §P4): a non-member's store is byte-identical before/after a rejected
 * attempt (catches a buggy-permissive gate — data would have flowed); revocation freezes the
 * revoked peer (future withheld) while its existing data stays (no-confiscation); revocation is
 * pairwise (a non-compliant member still syncs with the revoked peer). Provenance (VV peerId ∈
 * allowlist) is enforced at the gate boundary here — per-op VV provenance is a production-integration
 * detail (Loro `setPeerId` is numeric; the pubHex→peerId mapping is deferred to production).
 */

const newDocSet = (): DocSet => new Map();

describe("P4 pubkey allowlist / membership gating", () => {
  it("S4.1 member converges; non-member is rejected with NO data flow (no leak)", async () => {
    const idA = newIdentity();
    const idB = newIdentity();
    const idC = newIdentity();
    const a = newDocSet();
    const b = newDocSet();
    const c = newDocSet();
    createNode(a, "main", "n1", "s1", "secret");

    // Member B is in A's allowlist and vice-versa → exchange succeeds, B gets the data.
    await gated(a, b, idA, idB, allowlistOf(idB), allowlistOf(idA));
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));
    expect(b.get("s1")!.getMap("entities").get("n1")).toBeDefined();

    // Non-member C: C considers A a member, but A's allowlist does NOT include C → A rejects.
    const aBefore = canonicalDocSet(a);
    const cBefore = canonicalDocSet(c);
    await expect(gated(a, c, idA, idC, allowlistOf(idB), allowlistOf(idA))).rejects.toThrow(
      /not in allowlist|invalid/,
    );
    expect(canonicalDocSet(a)).toBe(aBefore); // A unchanged — nothing leaked to C
    expect(canonicalDocSet(c)).toBe(cBefore); // C unchanged — no data flowed
  });

  it("S4.3 revocation freezes future updates but cannot confiscate existing data", async () => {
    const idA = newIdentity();
    const idB = newIdentity();
    const idM = newIdentity();
    const a = newDocSet();
    const b = newDocSet();
    const m = newDocSet();
    createNode(a, "main", "n1", "s1", "first");

    // A↔B and A↔M all sync (all members of each other).
    await gated(a, b, idA, idB, allowlistOf(idB), allowlistOf(idA));
    await gated(a, m, idA, idM, allowlistOf(idM), allowlistOf(idA));
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(m));

    // A REVOKES M (drops idM from its allowlist, keeps only B). A keeps editing.
    createNode(a, "main", "n2", "s2", "after-revoke");
    const mBefore = canonicalDocSet(m);
    await expect(gated(a, m, idA, idM, allowlistOf(idB), allowlistOf(idA))).rejects.toThrow(
      /not in allowlist|invalid/,
    );

    expect(canonicalDocSet(m)).toBe(mBefore); // M frozen — A's new edit did NOT arrive
    expect(m.get("s2")).toBeUndefined(); // the post-revocation node never reached M
    // no-confiscation: M's pre-revocation data is intact
    expect(m.get("s1")!.getMap("entities").get("n1")).toBeDefined();
  });

  it("S4.4 revocation is PAIRWISE: M syncs with a compliant member, not with the revoker", async () => {
    const idA = newIdentity();
    const idB = newIdentity();
    const idM = newIdentity();
    const idC = newIdentity();
    const a = newDocSet();
    const m = newDocSet();
    const c = newDocSet();
    createNode(a, "main", "n1", "s1", "shared");

    // C is a compliant member that keeps M in its allowlist; A and B dropped M.
    await gated(a, c, idA, idC, allowlistOf(idC), allowlistOf(idA)); // seed C with the data

    // M can still sync with C (both have each other) → converges.
    await gated(m, c, idM, idC, allowlistOf(idC), allowlistOf(idM));
    expect(canonicalDocSet(m)).toBe(canonicalDocSet(c));
    expect(m.get("s1")!.getMap("entities").get("n1")).toBeDefined();

    // M CANNOT sync with A (A dropped M) — rejected.
    await expect(gated(a, m, idA, idM, allowlistOf(idB), allowlistOf(idA))).rejects.toThrow(
      /not in allowlist|invalid/,
    );
  });

  it("a peer whose pubHex is not in the allowlist is rejected at the gate", async () => {
    const idA = newIdentity();
    const idB = newIdentity();
    const idImposter = newIdentity();
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "n1", "s1", "x");

    // Imposter presents its own pubHex; A's allowlist has only B → rejected at the allowlist check.
    await expect(gated(a, b, idA, idImposter, allowlistOf(idB), allowlistOf(idA))).rejects.toThrow(
      /not in allowlist/,
    );
  });

  it("allowlisted pubHex + WRONG-key signature is rejected (signature verification exercised)", async () => {
    // A peer presents B's pubHex (which IS in A's allowlist) but signs with a different private key.
    // The allowlist check passes; the signature check must catch the forgery. Without this, the
    // idVerify branch would be dead code (the other tests only hit the allowlist branch).
    const idA = newIdentity();
    const idB = newIdentity();
    const idImposter = newIdentity();
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "n1", "s1", "x");

    const forged: Identity = { pubHex: idB.pubHex, privateKey: idImposter.privateKey };
    const aBefore = canonicalDocSet(a);
    const bBefore = canonicalDocSet(b);
    await expect(gated(a, b, idA, forged, allowlistOf(idB), allowlistOf(idA))).rejects.toThrow(
      /invalid/,
    );
    // no data flowed despite the allowlisted pubHex — the signature check caught the forgery first
    expect(canonicalDocSet(a)).toBe(aBefore);
    expect(canonicalDocSet(b)).toBe(bBefore);
  });
});
