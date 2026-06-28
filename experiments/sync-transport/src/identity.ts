import { createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";

/**
 * Device identity for the playground's membership gate — a real Ed25519 keypair. The public key
 * (SPKI DER, hex) is the device identity AND the per-workspace allowlist key. The design doc
 * (§8) says the pubkey is the Loro VV `peerId` too; Loro's `setPeerId` takes a NUMERIC id, so the
 * pubHex→peerId mapping is a production-integration detail — the playground enforces membership at
 * the connection gate (auth handshake before any exchange), which is where it structurally belongs.
 *
 * Auth is a challenge-response: each side signs the PEER's pubHex to prove ownership of its own
 * claimed key, bound to this session. The playground validates the policy wiring (allowlist check
 * + signature verification gate the exchange), NOT the cryptographic strength of Ed25519 itself.
 */
export type Identity = {
  readonly pubHex: string;
  readonly privateKey: KeyObject;
};

export function newIdentity(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");
  return { pubHex, privateKey };
}

/** Allowlist of member public keys for a workspace. */
export type Allowlist = Set<string>;

export function allowlistOf(...ids: Identity[]): Allowlist {
  return new Set(ids.map((i) => i.pubHex));
}

export function idSign(id: Identity, data: Uint8Array): Uint8Array {
  return new Uint8Array(sign(null, Buffer.from(data), id.privateKey));
}

/** Verify `sig` was produced by the holder of `pubHex` over `data`. Reconstructs the public
 *  KeyObject from the SPKI-DER hex. Returns false on any malformed input (never throws). */
export function idVerify(pubHex: string, data: Uint8Array, sig: Uint8Array): boolean {
  try {
    const pub = createPublicKey({ key: Buffer.from(pubHex, "hex"), format: "der", type: "spki" });
    return verify(null, Buffer.from(data), pub, Buffer.from(sig));
  } catch {
    return false;
  }
}
