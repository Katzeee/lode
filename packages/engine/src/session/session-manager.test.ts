import { describe, expect, it } from "vitest";
import { SessionManager } from "./session-manager.js";

// F4: the challenge lifecycle — crypto-free nonce issue/consume. The signature verification itself is
// exercised end-to-end in the daemon integration tests; this unit-tests the nonce state machine
// (single-use, mismatch, supersede) that makes replay impossible.

describe("SessionManager challenge-response (F4)", () => {
  it("issueChallenge yields a 32-byte nonce that consumeChallenge accepts once", () => {
    const sm = new SessionManager("node-1");
    const nonce = sm.issueChallenge("conn-1");
    expect(nonce).toHaveLength(32);
    expect(sm.consumeChallenge("conn-1", nonce)).toBe(true);
  });

  it("consumeChallenge is single-use — a second consume of the same nonce fails", () => {
    const sm = new SessionManager("node-1");
    const nonce = sm.issueChallenge("conn-1");
    expect(sm.consumeChallenge("conn-1", nonce)).toBe(true);
    expect(sm.consumeChallenge("conn-1", nonce)).toBe(false);
  });

  it("consumeChallenge rejects a nonce for a connection that was never issued one", () => {
    const sm = new SessionManager("node-1");
    expect(sm.consumeChallenge("conn-x", new Uint8Array(32))).toBe(false);
  });

  it("consumeChallenge rejects a mismatched nonce (and revokes the pending one)", () => {
    const sm = new SessionManager("node-1");
    sm.issueChallenge("conn-1");
    expect(sm.consumeChallenge("conn-1", new Uint8Array(32))).toBe(false);
    // The mismatched attempt revoked the pending nonce → it can no longer be used.
    expect(sm.consumeChallenge("conn-1", new Uint8Array(32))).toBe(false);
  });

  it("a fresh issueChallenge supersedes a pending one for the same connection", () => {
    const sm = new SessionManager("node-1");
    const n1 = sm.issueChallenge("conn-1");
    const n2 = sm.issueChallenge("conn-1");
    expect(Buffer.from(n1).equals(Buffer.from(n2))).toBe(false);
    expect(sm.consumeChallenge("conn-1", n2)).toBe(true); // latest wins
    expect(sm.consumeChallenge("conn-1", n1)).toBe(false); // superseded + now consumed
  });
});
