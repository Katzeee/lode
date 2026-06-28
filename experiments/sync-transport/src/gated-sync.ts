import { Buffer } from "node:buffer";
import { FrameSocket } from "./wire.js";
import { makeLoopbackPair } from "./socket-sync.js";
import { exchangeDocSetSide, type DocSet } from "./multi-sync.js";
import { idSign, idVerify, type Allowlist, type Identity } from "./identity.js";

/**
 * Membership-gated sync. Before any doc bytes cross, each side runs an auth handshake:
 *   1. send its own pubHex (`auth`);
 *   2. recv peer pubHex; REJECT if peer ∉ own allowlist (client-side enforcement — the relay is
 *      untrusted and protocol-blind, so membership is enforced by each member, not the relay);
 *   3. send a signature over the PEER's pubHex (`auth-sig`) — proves ownership of the claimed key;
 *   4. recv + verify the peer's signature; REJECT if invalid.
 * Only if BOTH sides pass do they proceed to the normal doc-set exchange over the same connection.
 * A rejection throws BEFORE any doc exchange → no data flows to a non-member / revoked peer.
 *
 * This is the design's egalitarian membership model (§4, §6): no admin, no roles; binary
 * membership via per-workspace pubkey allowlist; revocation = a member drops the peer's pubkey
 * from its allowlist → the next sync attempt is rejected at this gate.
 */
async function authSide(sock: FrameSocket, id: Identity, allowlist: Allowlist): Promise<string> {
  sock.send({ kind: "auth", pubHex: id.pubHex });
  const peerAuth = await sock.recv();
  if (peerAuth.kind !== "auth") {
    throw new Error(`expected auth, got ${peerAuth.kind}`);
  }
  if (!allowlist.has(peerAuth.pubHex)) {
    throw new Error(`rejected: peer ${peerAuth.pubHex.slice(0, 16)}… not in allowlist`);
  }
  // Sign the peer's pubHex to prove we own our key (challenge bound to this peer + session).
  sock.send({ kind: "auth-sig", sig: idSign(id, Buffer.from(peerAuth.pubHex, "utf8")) });
  const peerSig = await sock.recv();
  if (peerSig.kind !== "auth-sig") {
    throw new Error(`expected auth-sig, got ${peerSig.kind}`);
  }
  // The peer signed OUR pubHex; verify with the peer's pubHex.
  if (!idVerify(peerAuth.pubHex, Buffer.from(id.pubHex, "utf8"), peerSig.sig)) {
    throw new Error("rejected: peer signature invalid");
  }
  return peerAuth.pubHex;
}

/** Gated exchange: auth handshake, then (only on success) the doc-set exchange. Rejects (throws)
 *  if either side fails auth — and on rejection NO doc bytes are exchanged (data cannot leak to a
 *  non-member, and a rejected peer's store is untouched). */
export async function exchangeGatedOverWire(
  a: DocSet,
  b: DocSet,
  idA: Identity,
  idB: Identity,
  allowA: Allowlist,
  allowB: Allowlist,
  only?: Set<string>,
): Promise<void> {
  const { a: sa, b: sb, close } = await makeLoopbackPair();
  try {
    // Auth both sides; any rejection rejects the round before any doc exchange.
    await Promise.all([authSide(sa, idA, allowA), authSide(sb, idB, allowB)]);
    // Auth passed → run the normal per-doc exchange over the same connection.
    await Promise.all([exchangeDocSetSide(a, sa, only), exchangeDocSetSide(b, sb, only)]);
  } finally {
    close();
  }
}
