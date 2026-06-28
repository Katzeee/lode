import { describe, expect, it } from "vitest";
import {
  actorIdFromPublicKey,
  deserializeActorPrivateKey,
  generateActorKeypair,
  serializeActorPrivateKey,
  signWithActor,
  verifyActorSignature,
} from "./actor-key.js";

describe("actor-key", () => {
  it("generates a keypair whose actorId is the hex of the 32-byte public key", () => {
    const { actorId, publicKey } = generateActorKeypair();
    expect(publicKey).toHaveLength(32);
    expect(actorId).toBe(actorIdFromPublicKey(publicKey));
    expect(actorId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signs and verifies (round trip)", () => {
    const { privateKey, publicKey } = generateActorKeypair();
    const data = new TextEncoder().encode("hello actor");
    const sig = signWithActor(privateKey, data);
    expect(sig).toHaveLength(64);
    expect(verifyActorSignature(publicKey, data, sig)).toBe(true);
  });

  it("rejects a signature verified against the wrong public key", () => {
    const a = generateActorKeypair();
    const b = generateActorKeypair();
    const data = new TextEncoder().encode("payload");
    const sig = signWithActor(a.privateKey, data);
    expect(verifyActorSignature(b.publicKey, data, sig)).toBe(false);
    expect(verifyActorSignature(a.publicKey, data, sig)).toBe(true);
  });

  it("rejects tampered data or tampered signatures", () => {
    const { privateKey, publicKey } = generateActorKeypair();
    const data = new TextEncoder().encode("original");
    const sig = signWithActor(privateKey, data);
    const tamperedData = new TextEncoder().encode("modified");
    expect(verifyActorSignature(publicKey, tamperedData, sig)).toBe(false);
    const badSig = Uint8Array.from(sig, (b, i) => (i === 0 ? b ^ 0xff : b));
    expect(verifyActorSignature(publicKey, data, badSig)).toBe(false);
  });

  it("returns false (never throws) on malformed inputs", () => {
    const { publicKey } = generateActorKeypair();
    const data = new TextEncoder().encode("x");
    expect(verifyActorSignature(publicKey, data, new Uint8Array(10))).toBe(false);
    expect(verifyActorSignature(new Uint8Array(5), data, new Uint8Array(64))).toBe(false);
  });

  it("round-trips the private key through keystore serialization", () => {
    const kp = generateActorKeypair();
    const data = new TextEncoder().encode("persisted");
    const sig = signWithActor(kp.privateKey, data);
    const restored = deserializeActorPrivateKey(serializeActorPrivateKey(kp.privateKey));
    // A signature from the restored key verifies against the original public key.
    expect(verifyActorSignature(kp.publicKey, data, signWithActor(restored, data))).toBe(true);
    // And the original signature still verifies (key material unchanged).
    expect(verifyActorSignature(kp.publicKey, data, sig)).toBe(true);
  });
});
