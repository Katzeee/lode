import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateActorKeypair } from "../../crypto/index.js";
import { open, seal, type WireOpenContext, type WireSealContext } from "./wire-security.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const newTransitKey = (): Uint8Array => randomBytes(32);

describe("wire-security", () => {
  it("seal/open round-trips a payload between two members", () => {
    const tk = newTransitKey();
    const sender = generateActorKeypair();
    const sealCtx: WireSealContext = {
      transitKey: tk,
      actorId: sender.actorId,
      actorPrivateKey: sender.privateKey,
    };
    const openCtx: WireOpenContext = {
      transitKey: tk,
      resolveActorPub: (id) => (id === sender.actorId ? sender.publicKey : undefined),
    };
    const plain = enc("a sync message body");
    const blob = seal(sealCtx, plain);
    expect(Buffer.from(open(openCtx, blob)).toString()).toBe("a sync message body");
  });

  it("the sealed blob does NOT contain the plaintext (ciphertext opacity)", () => {
    const tk = newTransitKey();
    const sender = generateActorKeypair();
    const blob = seal(
      { transitKey: tk, actorId: sender.actorId, actorPrivateKey: sender.privateKey },
      enc("SECRET-sentinel"),
    );
    // The plaintext sentinel must not appear anywhere in the sealed blob.
    expect(Buffer.from(blob).includes(Buffer.from("SECRET"))).toBe(false);
    expect(Buffer.from(blob).includes(Buffer.from("sentinel"))).toBe(false);
  });

  it("open fails with the wrong transit key (a non-member can't decrypt)", () => {
    const sealTk = newTransitKey();
    const member = generateActorKeypair();
    const blob = seal(
      { transitKey: sealTk, actorId: member.actorId, actorPrivateKey: member.privateKey },
      enc("payload"),
    );
    const openCtx: WireOpenContext = {
      transitKey: newTransitKey(), // a DIFFERENT key
      resolveActorPub: (id) => (id === member.actorId ? member.publicKey : undefined),
    };
    expect(() => open(openCtx, blob)).toThrow();
  });

  it("open rejects a tampered blob (AEAD integrity)", () => {
    const tk = newTransitKey();
    const sender = generateActorKeypair();
    const blob = Buffer.from(
      seal(
        { transitKey: tk, actorId: sender.actorId, actorPrivateKey: sender.privateKey },
        enc("payload"),
      ),
    );
    const idx = blob.length - 5; // inside the AEAD region
    blob.writeUInt8(blob.readUInt8(idx) ^ 0xff, idx);
    const openCtx: WireOpenContext = {
      transitKey: tk,
      resolveActorPub: (id) => (id === sender.actorId ? sender.publicKey : undefined),
    };
    expect(() => open(openCtx, blob)).toThrow();
  });

  it("open rejects a forged signature (wrong key signed)", () => {
    const tk = newTransitKey();
    const sender = generateActorKeypair();
    const impostor = generateActorKeypair();
    // Seal claiming to be the impostor's id but... actually seal signs with its own key. To forge,
    // build a blob whose sig was produced by a different key than the resolved pubkey.
    const blob = seal(
      { transitKey: tk, actorId: impostor.actorId, actorPrivateKey: impostor.privateKey },
      enc("payload"),
    );
    const openCtx: WireOpenContext = {
      transitKey: tk,
      // Resolve the impostor's id to the SENDER's pubkey → sig won't verify.
      resolveActorPub: (id) => (id === impostor.actorId ? sender.publicKey : undefined),
    };
    expect(() => open(openCtx, blob)).toThrow(/bad signature/);
  });

  it("membership enforcement: a VALIDLY-SIGNED payload from an actor NOT in the member set is rejected", () => {
    // The headline authenticity/membership property — what distinguishes confidentiality from
    // membership enforcement. A sender who legitimately holds the transit key AND produces a valid
    // Ed25519 signature, but whose actorId the recipient does not recognize (resolveActorPub →
    // undefined), is rejected. AEAD decrypts fine and the signature is cryptographically valid; the
    // resolveActorPub gate is what enforces "sender must be a known member." (A future refactor that
    // reordered/cached this check must not silently weaken it — that's why this is asserted directly.)
    const tk = newTransitKey();
    const sender = generateActorKeypair();
    const blob = seal(
      { transitKey: tk, actorId: sender.actorId, actorPrivateKey: sender.privateKey },
      enc("payload"),
    );
    const openCtx: WireOpenContext = { transitKey: tk, resolveActorPub: () => undefined };
    expect(() => open(openCtx, blob)).toThrow(/unknown actor/);
  });

  it("a fresh nonce per seal (two seals of the same plaintext differ)", () => {
    const tk = newTransitKey();
    const sender = generateActorKeypair();
    const ctx = { transitKey: tk, actorId: sender.actorId, actorPrivateKey: sender.privateKey };
    const a = seal(ctx, enc("same"));
    const b = seal(ctx, enc("same"));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
