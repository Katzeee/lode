import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { unwrapKey, wrapKey } from "./transit-wrap.js";
import { peerKeypairFromPrivateKey, generatePeerKeypair } from "./peer-key.js";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

describe("transit-wrap (per-peer X25519)", () => {
  it("peerKeypairFromPrivateKey reconstructs the public from the private scalar", () => {
    const kp = generatePeerKeypair();
    const restored = peerKeypairFromPrivateKey(kp.privateKey);
    expect(hex(restored.publicKey)).toBe(hex(kp.publicKey));
    expect(hex(restored.privateKey)).toBe(hex(kp.privateKey));
  });

  it("peerKeypairFromPrivateKey rejects a wrong-length scalar", () => {
    const kp = generatePeerKeypair();
    expect(() => peerKeypairFromPrivateKey(new Uint8Array(31))).toThrow();
    // Round-trip via the raw 32-byte scalar (what persistence stores, hex-encoded at the registry).
    const restored = peerKeypairFromPrivateKey(new Uint8Array(kp.privateKey));
    expect(hex(restored.publicKey)).toBe(hex(kp.publicKey));
  });

  it("wrap/unwrap round-trips a transit key to the peer", () => {
    const recipient = generatePeerKeypair();
    const transitKey = randomBytes(32);
    const wrapped = wrapKey(recipient.publicKey, transitKey);
    const recovered = unwrapKey(recipient.privateKey, wrapped);
    expect(hex(recovered)).toBe(hex(transitKey));
  });

  it("a wrapped key cannot be unwrapped by a different peer (AEAD tag fails)", () => {
    const recipient = generatePeerKeypair();
    const stranger = generatePeerKeypair();
    const wrapped = wrapKey(recipient.publicKey, randomBytes(32));
    expect(() => unwrapKey(stranger.privateKey, wrapped)).toThrow();
  });

  it("rejects a truncated wrapped blob", () => {
    const recipient = generatePeerKeypair();
    expect(() => unwrapKey(recipient.privateKey, randomBytes(10))).toThrow();
  });

  it("two wraps of the same transit key differ (ephemeral-key freshness)", () => {
    // Proves the ephemeral X25519 key is generated per wrap — without this, a regression to a
    // static/reused ephemeral key would pass every other test and silently break unlinkability.
    const recipient = generatePeerKeypair();
    const transitKey = randomBytes(32);
    const w1 = wrapKey(recipient.publicKey, transitKey);
    const w2 = wrapKey(recipient.publicKey, transitKey);
    expect(hex(w1)).not.toBe(hex(w2));
    // ...but both unwrap to the same transit key.
    expect(hex(unwrapKey(recipient.privateKey, w1))).toBe(hex(transitKey));
    expect(hex(unwrapKey(recipient.privateKey, w2))).toBe(hex(transitKey));
  });

  it("wraps one transit key to many peers; each unwraps, a non-member cannot (the membership use case)", () => {
    const first = generatePeerKeypair();
    const members = [first, generatePeerKeypair(), generatePeerKeypair()];
    const stranger = generatePeerKeypair();
    const transitKey = randomBytes(32);
    for (const m of members) {
      const wrapped = wrapKey(m.publicKey, transitKey);
      expect(hex(unwrapKey(m.privateKey, wrapped))).toBe(hex(transitKey));
    }
    const firstWrapped = wrapKey(first.publicKey, transitKey);
    expect(() => unwrapKey(stranger.privateKey, firstWrapped)).toThrow();
  });

  it("rejects a same-length tamper of the ciphertext region (AEAD integrity)", () => {
    const recipient = generatePeerKeypair();
    const wrapped = Buffer.from(wrapKey(recipient.publicKey, randomBytes(32)));
    const i = wrapped.length - 20; // well inside the AEAD region (past ephPub + nonce)
    wrapped.writeUInt8(wrapped.readUInt8(i) ^ 0xff, i);
    expect(() => unwrapKey(recipient.privateKey, wrapped)).toThrow();
  });

  it("rejects a tamper of the embedded ephemeral public key", () => {
    const recipient = generatePeerKeypair();
    const wrapped = Buffer.from(wrapKey(recipient.publicKey, randomBytes(32)));
    wrapped.writeUInt8(wrapped.readUInt8(5) ^ 0xff, 5); // first 32 bytes = ephemeral X25519 public
    expect(() => unwrapKey(recipient.privateKey, wrapped)).toThrow();
  });
});
