import { scrypt, type ScryptOptions } from "node:crypto";

// The vault's passphrase KDF: scrypt (node:crypto, memory-hard, zero dependency, audited). The plan
// named argon2id/hash-wasm, but hash-wasm 2.x dropped argon2; rather than pin a stale major or add a
// WASM argon2 dep, scrypt — the built-in memory-hard KDF — honors the actual constraint (no native
// build surface) and intent (a slow, memory-hard brake against offline brute force). Runs on the libuv
// threadpool (async), so the heavy DEFAULT params don't block the daemon's event loop during unlock.
// Params + salt are stored per-vault in vault.json; a wrong passphrase yields a wrong key and the AEAD
// open fails (authenticated).

/** scrypt parameters: `n` = CPU/memory cost, `r` = block size, `p` = parallelism. */
export type KdfParams = { n: number; r: number; p: number };

/** Default ~64 MiB / single-pass — a deliberate offline-brake (tests inject lighter params). */
export const DEFAULT_KDF_PARAMS: KdfParams = { n: 65_536, r: 8, p: 1 };

function scryptAsync(
  passphrase: string,
  salt: Uint8Array,
  keyLen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, keyLen, options, (error, derived) => {
      if (error !== null) {
        reject(error);
      } else {
        resolve(derived);
      }
    });
  });
}

/** Derive a `keyLen`-byte key from a passphrase + salt via scrypt (runs off the event loop). */
export async function deriveVaultKey(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams,
  keyLen = 32,
): Promise<Uint8Array> {
  const derived = await scryptAsync(passphrase, salt, keyLen, {
    N: params.n,
    r: params.r,
    p: params.p,
    // node caps scrypt memory; raise it above the working set (128·n·r bytes).
    maxmem: 128 * params.n * params.r * 2,
  });
  return new Uint8Array(derived);
}
