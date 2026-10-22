import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import { signingKeyPairFromSeed, type SigningKeyPair } from "./keys.js";

/**
 * Actor recovery phrases. A 12-word BIP-39 English mnemonic with an empty
 * passphrase derives the Ed25519 seed, so the same phrase always restores the
 * same Actor identity — the continuity invariant behind every export/import.
 */

export function generateRecoveryPhrase(): Readonly<{ phrase: string; keyPair: SigningKeyPair }> {
  const phrase = generateMnemonic(wordlist, 128);
  return { phrase, keyPair: keyPairFromPhrase(phrase) };
}

export function keyPairFromPhrase(phrase: string): SigningKeyPair {
  if (!validateMnemonic(normalizePhrase(phrase), wordlist)) {
    throw new Error("Recovery phrase is not a valid BIP-39 mnemonic");
  }
  const seed64 = mnemonicToSeedSync(normalizePhrase(phrase));
  return signingKeyPairFromSeed(seed64.subarray(0, 32));
}

/** Whitespace-insensitive phrase comparison and storage. */
export function normalizePhrase(phrase: string): string {
  return phrase.trim().split(/\s+/u).join(" ").toLowerCase();
}
