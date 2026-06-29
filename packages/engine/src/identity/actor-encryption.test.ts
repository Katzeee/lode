import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { x25519 } from "@noble/curves/ed25519";
import { generateMnemonic } from "../utils/crypto/bip39.js";
import {
  actorEncryptionPrivate,
  actorEncryptionPublic,
  unwrapKey,
  wrapKey,
} from "./actor-encryption.js";
import { deriveActorKeypairFromMnemonic, generateActorKeypair } from "./actor-key.js";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

describe("actor-encryption (dual-use)", () => {
  it("X25519 public matches the public derived from the X25519 private scalar", () => {
    // Cross-check the two conversion paths agree: getPublicKey(toMontgomerySecret(seed))
    // === toMontgomery(ed25519Pub). This is the property that makes wrap (pub) / unwrap
    // (priv) a matching pair for a single actor key.
    const kp = generateActorKeypair();
    const pub = actorEncryptionPublic(kp.publicKey);
    const priv = actorEncryptionPrivate(kp.privateKey);
    expect(hex(x25519.getPublicKey(priv))).toBe(hex(pub));
  });

  it("ECDH is symmetric across two actors", () => {
    const a = generateActorKeypair();
    const b = generateActorKeypair();
    const sharedAB = x25519.getSharedSecret(
      actorEncryptionPrivate(a.privateKey),
      actorEncryptionPublic(b.publicKey),
    );
    const sharedBA = x25519.getSharedSecret(
      actorEncryptionPrivate(b.privateKey),
      actorEncryptionPublic(a.publicKey),
    );
    expect(hex(sharedAB)).toBe(hex(sharedBA));
  });

  it("actorEncryptionPublic is deterministic for a given Ed25519 public key", () => {
    const kp = generateActorKeypair();
    expect(actorEncryptionPublic(kp.publicKey)).toEqual(actorEncryptionPublic(kp.publicKey));
  });

  it("wrap/unwrap round-trips a transit key to the recipient", () => {
    const recipient = generateActorKeypair();
    const transitKey = randomBytes(32);
    const wrapped = wrapKey(actorEncryptionPublic(recipient.publicKey), transitKey);
    const recovered = unwrapKey(actorEncryptionPrivate(recipient.privateKey), wrapped);
    expect(hex(recovered)).toBe(hex(transitKey));
  });

  it("a wrapped key cannot be unwrapped by a different actor (AEAD tag fails)", () => {
    const recipient = generateActorKeypair();
    const stranger = generateActorKeypair();
    const wrapped = wrapKey(actorEncryptionPublic(recipient.publicKey), randomBytes(32));
    expect(() => unwrapKey(actorEncryptionPrivate(stranger.privateKey), wrapped)).toThrow();
  });

  it("rejects a truncated wrapped blob", () => {
    const recipient = generateActorKeypair();
    expect(() =>
      unwrapKey(actorEncryptionPrivate(recipient.privateKey), randomBytes(10)),
    ).toThrow();
  });

  it("actorEncryptionPrivate is deterministic for a given private key", () => {
    const kp = generateActorKeypair();
    expect(actorEncryptionPrivate(kp.privateKey)).toEqual(actorEncryptionPrivate(kp.privateKey));
  });

  it("two wraps of the same transit key differ (ephemeral-key freshness)", () => {
    // Proves the ephemeral X25519 key is actually generated per wrap — without this, a regression to
    // a static/reused ephemeral key would pass every other test and silently break unlinkability.
    const recipient = generateActorKeypair();
    const transitKey = randomBytes(32);
    const w1 = wrapKey(actorEncryptionPublic(recipient.publicKey), transitKey);
    const w2 = wrapKey(actorEncryptionPublic(recipient.publicKey), transitKey);
    expect(hex(w1)).not.toBe(hex(w2));
    // ...but both unwrap to the same transit key.
    expect(hex(unwrapKey(actorEncryptionPrivate(recipient.privateKey), w1))).toBe(hex(transitKey));
    expect(hex(unwrapKey(actorEncryptionPrivate(recipient.privateKey), w2))).toBe(hex(transitKey));
  });

  it("wraps one transit key to many members; each unwraps, a non-member cannot (the membership use case)", () => {
    const owner = generateActorKeypair();
    const firstMember = generateActorKeypair();
    const members = [firstMember, generateActorKeypair(), generateActorKeypair()];
    const stranger = generateActorKeypair();
    const transitKey = randomBytes(32);
    for (const m of members) {
      const wrapped = wrapKey(actorEncryptionPublic(m.publicKey), transitKey);
      expect(hex(unwrapKey(actorEncryptionPrivate(m.privateKey), wrapped))).toBe(hex(transitKey));
    }
    // Owner (not a wrap recipient) and an unrelated actor cannot unwrap a member's blob.
    const membersWrapped = wrapKey(actorEncryptionPublic(firstMember.publicKey), transitKey);
    expect(() => unwrapKey(actorEncryptionPrivate(owner.privateKey), membersWrapped)).toThrow();
    expect(() => unwrapKey(actorEncryptionPrivate(stranger.privateKey), membersWrapped)).toThrow();
  });

  it("rejects a same-length tamper of the ciphertext region (AEAD integrity)", () => {
    const recipient = generateActorKeypair();
    const wrapped = Buffer.from(
      wrapKey(actorEncryptionPublic(recipient.publicKey), randomBytes(32)),
    );
    // Flip a byte well inside the AEAD region (past ephPub + nonce).
    const i = wrapped.length - 20;
    wrapped.writeUInt8(wrapped.readUInt8(i) ^ 0xff, i);
    expect(() => unwrapKey(actorEncryptionPrivate(recipient.privateKey), wrapped)).toThrow();
  });

  it("rejects a tamper of the embedded ephemeral public key", () => {
    const recipient = generateActorKeypair();
    const wrapped = Buffer.from(
      wrapKey(actorEncryptionPublic(recipient.publicKey), randomBytes(32)),
    );
    wrapped.writeUInt8(wrapped.readUInt8(5) ^ 0xff, 5); // first 32 bytes = ephemeral X25519 public
    expect(() => unwrapKey(actorEncryptionPrivate(recipient.privateKey), wrapped)).toThrow();
  });

  it("encryption half survives mnemonic recovery: a key wrapped by one device unwraps on another", () => {
    // Continuity must hold for BOTH halves of the dual-use key. Device A derives from the mnemonic
    // and wraps; device B re-derives the same mnemonic and unwraps.
    const mnemonic = generateMnemonic();
    const a = deriveActorKeypairFromMnemonic(mnemonic);
    const b = deriveActorKeypairFromMnemonic(mnemonic);
    expect(actorEncryptionPublic(a.publicKey)).toEqual(actorEncryptionPublic(b.publicKey));
    expect(actorEncryptionPrivate(a.privateKey)).toEqual(actorEncryptionPrivate(b.privateKey));
    const transitKey = randomBytes(32);
    const wrapped = wrapKey(actorEncryptionPublic(a.publicKey), transitKey);
    expect(hex(unwrapKey(actorEncryptionPrivate(b.privateKey), wrapped))).toBe(hex(transitKey));
  });
});
