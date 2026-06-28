import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { canonicalDocSet, createNode, type DocSet } from "../src/multi-sync.js";
import { exchangeOverRelay, makeAesGcmCipher } from "../src/relay.js";

/**
 * P5 — transit privacy + relay-blind transport. An instrumented dumb relay forwards bytes between
 * two peers; peers encrypt end-to-end (AES-256-GCM) so the relay sees only ciphertext. This models
 * the production shape (design §3, §5): relay protocol-blind + E2E-encrypted. Real WireGuard
 * provides this in production; the playground validates the PROPERTY (relay cannot read content)
 * with an AEAD cipher, and skips the over-real-WireGuard tests when `hasWireGuard()` is false.
 *
 * Oracle (per TEST-MODEL §P5): a known plaintext SENTINEL written into a doc's content must (a)
 * reach the receiver (convergence) and (b) NEVER appear in the relay's forwarded-byte log. The
 * negative control (no cipher) confirms the oracle is meaningful — without encryption the sentinel
 * IS visible to the relay.
 */

const newDocSet = (): DocSet => new Map();
const seenBy = (buf: Buffer, sentinel: string): boolean =>
  buf.includes(Buffer.from(sentinel, "utf8"));

describe("P5 transit privacy (AES-256-GCM over an instrumented relay)", () => {
  it("S5.1 with E2E cipher: relay sees only ciphertext — the sentinel is absent from its log", async () => {
    const a = newDocSet();
    const b = newDocSet();
    const sentinel = "TOPSECRET-sentinel-aa7c91f4";
    createNode(a, "main", "n1", "s1", sentinel);
    const key = randomBytes(32);

    const { relayBytes } = await exchangeOverRelay(a, b, makeAesGcmCipher(key));

    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b)); // convergence
    expect(canonicalDocSet(b)).toContain(sentinel); // the content reached B
    expect(relayBytes().length).toBeGreaterThan(0); // the relay DID forward bytes
    expect(seenBy(relayBytes(), sentinel)).toBe(false); // …but only ciphertext — sentinel hidden
  });

  it("negative control: WITHOUT a cipher the relay DOES see the plaintext sentinel", async () => {
    // Proves the oracle is meaningful: if encryption were a no-op, the relay would see the sentinel.
    const a = newDocSet();
    const b = newDocSet();
    const sentinel = "PLAINTEXT-visible-5532";
    createNode(a, "main", "n1", "s1", sentinel);

    const { relayBytes } = await exchangeOverRelay(a, b); // no cipher

    expect(canonicalDocSet(b)).toContain(sentinel); // convergence holds (wire still works)
    expect(seenBy(relayBytes(), sentinel)).toBe(true); // plaintext leaked to the relay
  });

  it("S5.4 relay statelessness: the relay forwards bytes but holds no doc state", async () => {
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "n1", "s1", "stateless-relay-test");
    const key = randomBytes(32);

    const { relayBytes } = await exchangeOverRelay(a, b, makeAesGcmCipher(key));

    // The relay forwarded ciphertext (it saw bytes) but holds no LoroDoc / decoded state — it is a
    // pure byte pipe by construction (no `relayDoc` exists). State lives only on the two peers.
    expect(relayBytes().length).toBeGreaterThan(0);
    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));
  });

  it("S5.x convergence still holds with the cipher on (encryption does not change the outcome)", async () => {
    // The cipher is a transport-layer concern; it must not change convergence. Three shards, both
    // directions dirty, over the encrypted relay → still converges.
    const a = newDocSet();
    const b = newDocSet();
    createNode(a, "main", "a1", "s1", "A-s1");
    createNode(b, "main", "b1", "s1", "B-s1");
    createNode(b, "main", "b2", "s2", "B-s2");

    await exchangeOverRelay(a, b, makeAesGcmCipher(randomBytes(32)));

    expect(canonicalDocSet(a)).toBe(canonicalDocSet(b));
    expect(a.get("s2")!.getMap("entities").get("b2")).toBeDefined();
    expect(b.get("s1")!.getMap("entities").get("a1")).toBeDefined();
  });
});
