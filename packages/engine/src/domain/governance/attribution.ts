import { actorPublicKeyFromId, verifyBytes } from "../../crypto/index.js";
import type { Fact } from "../fact/index.js";

/**
 * Fact attribution verification. The signature covers the Fact's
 * contentDigest and the verifying key is derived from the body's actorId, so
 * verification is a pure function of the Fact — no registry lookup, no
 * ordering assumptions, identical on every replica.
 */

const SIGNATURE_LENGTH = 64;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function verifyFactAttribution(fact: Fact): boolean {
  if (fact.attribution === null || !BASE64_PATTERN.test(fact.attribution)) {
    return false;
  }
  const signature = Buffer.from(fact.attribution, "base64");
  if (signature.length !== SIGNATURE_LENGTH) {
    return false;
  }
  const publicKey = actorPublicKeyFromId(fact.body.actorId);
  if (publicKey === null) {
    return false;
  }
  return verifyBytes(Buffer.from(fact.contentDigest, "utf8"), signature, publicKey);
}
