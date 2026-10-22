import { scryptAsync } from "@noble/hashes/scrypt.js";

import { randomBytes } from "./random.js";

/**
 * Passphrase hardening for the Actor Vault. Parameters travel with the vault
 * so lighter test parameters round-trip; the canary lets a wrong passphrase
 * fail authenticated even before any entry exists.
 */

export const VAULT_CANARY = "lode-actor-vault-v1";
export const MIN_PASSPHRASE_LENGTH = 8;

export type VaultKdfParameters = Readonly<{ n: number; r: number; p: number }>;

export const DEFAULT_VAULT_KDF_PARAMETERS: VaultKdfParameters = { n: 65_536, r: 8, p: 1 };

export function generateVaultSalt(): Uint8Array {
  return randomBytes(16);
}

export function deriveVaultKey(
  passphrase: string,
  salt: Uint8Array,
  parameters: VaultKdfParameters,
): Promise<Uint8Array> {
  return scryptAsync(new TextEncoder().encode(passphrase), salt, {
    N: parameters.n,
    r: parameters.r,
    p: parameters.p,
    dkLen: 32,
    maxmem: 128 * parameters.n * parameters.r * 2,
    asyncTick: 8,
  });
}
