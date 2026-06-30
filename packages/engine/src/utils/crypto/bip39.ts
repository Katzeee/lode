import {
  generateMnemonic as generateBip39Mnemonic,
  mnemonicToSeedSync,
  validateMnemonic as validateBip39Mnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/**
 * BIP-39 mnemonic recovery root (design sync-identity-persistence §3). The mnemonic is the recovery
 * anchor: same words → same seed → same SLIP-10 Ed25519 actor key, so a recovered owner on a new device
 * re-derives the same identity (the actor key does not rotate). Thin wrappers over the audited
 * @scure/bip39 (English wordlist, 12 words / 128-bit entropy) — we don't vendor the 2048-word list or
 * hand-roll the PBKDF2 seed / checksum. Generic crypto utility; the actor keypair derivation that
 * consumes it lives in `actor-key.ts`.
 */

const MNEMONIC_STRENGTH_BITS = 128; // → 12 words

/** Generate a fresh 12-word English mnemonic. */
export function generateMnemonic(): string {
  return generateBip39Mnemonic(wordlist, MNEMONIC_STRENGTH_BITS);
}

/** True if `mnemonic` is a well-formed English BIP-39 phrase with a valid checksum. */
export function validateMnemonic(mnemonic: string): boolean {
  return validateBip39Mnemonic(mnemonic, wordlist);
}

/** Mnemonic → 64-byte BIP-39 seed (PBKDF2-HMAC-SHA512, empty passphrase), fed to SLIP-10. */
export function mnemonicToSeed(mnemonic: string): Uint8Array {
  return mnemonicToSeedSync(mnemonic);
}
