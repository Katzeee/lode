import { AuthenticationError } from "../../errors/index.js";
import { deriveActorKeypairFromMnemonic, type ActorKeypair } from "../../crypto/index.js";

// How a mnemonic derives the actor signing keypair. The identity IS the derived actor id — no
// declared actor to cross-check — so a bad/undecodable mnemonic is an authentication failure, not a
// stored transformation. Identity minting (a fresh mnemonic + persisting it in the vault) lives in
// `vault.createIdentity`; this module only derives.

/** Derive the actor keypair from a mnemonic, rejecting a bad/undecodable one as an auth failure. */
export function deriveActorKeypair(mnemonic: string): ActorKeypair {
  try {
    return deriveActorKeypairFromMnemonic(mnemonic);
  } catch {
    throw new AuthenticationError("sessionHello: actor authentication failed (bad mnemonic)");
  }
}
