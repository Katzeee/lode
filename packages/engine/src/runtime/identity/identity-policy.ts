import { AuthenticationError } from "../../errors/index.js";
import {
  deriveActorKeypairFromMnemonic,
  generateMnemonic,
  type ActorKeypair,
} from "../../crypto/index.js";

// The identity-bootstrap policy: how an actor identity is minted and how a mnemonic derives the
// signing keypair. The identity IS the derived actor id — no declared actor to cross-check — so a
// bad/undecodable mnemonic is an authentication failure, not a stored transformation.

/** Derive the actor keypair from a mnemonic, rejecting a bad/undecodable one as an auth failure. */
export function deriveActorKeypair(mnemonic: string): ActorKeypair {
  try {
    return deriveActorKeypairFromMnemonic(mnemonic);
  } catch {
    throw new AuthenticationError("sessionHello: actor authentication failed (bad mnemonic)");
  }
}

/** Mint a fresh actor identity: a 12-word mnemonic + the actor id it derives to. Unauthenticated by
 *  design — this is the bootstrap (`lode actor new`) called once, before any authed command. */
export function mintActorIdentity(): { mnemonic: string; actorId: string } {
  const mnemonic = generateMnemonic();
  return { mnemonic, actorId: deriveActorKeypairFromMnemonic(mnemonic).actorId };
}
