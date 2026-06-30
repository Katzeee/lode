import { createHmac } from "node:crypto";

/**
 * SLIP-10 Ed25519 hierarchical derivation from a BIP-39 seed (design sync-identity-persistence §3).
 * SLIP-10 Ed25519 supports hardened derivation only — each derived hash IS the Ed25519 seed (the hash
 * of the private key is the multiplier, so public-key derivation is impossible). It is a pure
 * HMAC-SHA512 chain (no curve arithmetic). lode's actor path is `m/44'/2026'/<account>'/0'/<index>'`.
 *
 * Verified against the SLIP-0010 Ed25519 test vectors (seed 000102…0f). See slip10.test.ts. Generic
 * crypto utility; the actor keypair derivation that consumes it lives in `actor-key.ts`.
 */

const HARDENED_OFFSET = 0x80000000; // 2^31
const LODE_PURPOSE = 44;
// Unregistered in SLIP-44; documented as lode's coin type (all derivation is hardened, so the exact
// number is just a namespacing constant — it keeps lode keys off other apps' derivation paths).
const LODE_COIN_TYPE = 2026;

export type Slip10Node = {
  readonly key: Uint8Array;
  readonly chainCode: Uint8Array;
};

function ser32be(i: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(i >>> 0, 0);
  return b;
}

function hmacSha512(key: Uint8Array, data: Uint8Array): Buffer {
  return createHmac("sha512", Buffer.from(key)).update(Buffer.from(data)).digest();
}

// Master node: I = HMAC-SHA512("ed25519 seed", S); IL = key, IR = chain code.
function masterNode(seed: Uint8Array): Slip10Node {
  const i = hmacSha512(Buffer.from("ed25519 seed"), seed);
  return { key: new Uint8Array(i.subarray(0, 32)), chainCode: new Uint8Array(i.subarray(32)) };
}

// Hardened child: I = HMAC-SHA512(cpar, 0x00 || kpar || ser32(i)). i must be ≥ 2^31.
function deriveHardenedChild(parent: Slip10Node, index: number): Slip10Node {
  const data = Buffer.concat([Buffer.from([0]), Buffer.from(parent.key), ser32be(index)]);
  const i = hmacSha512(parent.chainCode, data);
  return { key: new Uint8Array(i.subarray(0, 32)), chainCode: new Uint8Array(i.subarray(32)) };
}

/** Derive the SLIP-10 Ed25519 node at an explicit hardened index path (test vectors / power users). */
export function deriveEd25519Node(masterSeed: Uint8Array, hardenedIndices: number[]): Slip10Node {
  let node = masterNode(masterSeed);
  for (const index of hardenedIndices) {
    node = deriveHardenedChild(node, index);
  }
  return node;
}

/** lode actor Ed25519 seed at `m/44'/2026'/<account>'/0'/<index>'` (all components hardened). */
export function deriveEd25519Seed(masterSeed: Uint8Array, account = 0, index = 0): Uint8Array {
  const path = [
    LODE_PURPOSE + HARDENED_OFFSET,
    LODE_COIN_TYPE + HARDENED_OFFSET,
    account + HARDENED_OFFSET,
    HARDENED_OFFSET,
    index + HARDENED_OFFSET,
  ];
  return deriveEd25519Node(masterSeed, path).key;
}
