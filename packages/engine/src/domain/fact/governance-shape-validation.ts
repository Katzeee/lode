import { assertKeys, assertObject, requireSafeInteger, requireString } from "../../decoding/index.js";
import type { GovernanceAction, TransitEnvelope } from "./governance-types.js";

/** Base64 of exactly 32 bytes: 43 body characters plus one pad character. */
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function assertGovernanceAction(value: unknown): asserts value is GovernanceAction {
  assertObject(value, "Governance action");
  requireString(value.kind, "Governance action kind");
  switch (value.kind) {
    case "workspace-establish":
      assertKeys(value, ["kind", "ownerActorId"], "workspace-establish action");
      requireString(value.ownerActorId, "Governance owner Actor");
      return;
    case "actor-admit":
      assertKeys(value, ["kind", "actorId"], "actor-admit action");
      requireString(value.actorId, "Governance Actor");
      return;
    case "actor-remove":
      assertKeys(value, ["kind", "actorId"], "actor-remove action");
      requireString(value.actorId, "Governance Actor");
      return;
    case "owner-transfer":
      assertKeys(value, ["kind", "nextOwnerActorId"], "owner-transfer action");
      requireString(value.nextOwnerActorId, "Governance owner Actor");
      return;
    case "peer-admit":
      assertKeys(value, ["kind", "peerId", "peerKxPublicKey", "envelope", "epoch"], "peer-admit action");
      requireString(value.peerId, "Governance Peer");
      requirePublicKey(value.peerKxPublicKey, "Governance Peer exchange public key");
      assertEnvelope(value.envelope);
      requireSafeInteger(value.epoch, 0, "Governance Peer admission epoch");
      return;
    case "transit-rotate":
      assertKeys(value, ["kind", "epoch", "peers"], "transit-rotate action");
      requireSafeInteger(value.epoch, 0, "Governance transit epoch");
      assertPeerEnvelopes(value.peers);
      return;
    default:
      throw new Error(`Unknown Governance action kind: ${String(value.kind)}`);
  }
}

function assertPeerEnvelopes(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("transit-rotate requires a non-empty Peer envelope roster");
  }
  for (const entry of value) {
    assertObject(entry, "transit-rotate Peer entry");
    assertKeys(entry, ["peerId", "envelope"], "transit-rotate Peer entry");
    requireString(entry.peerId, "transit-rotate Peer");
    assertEnvelope(entry.envelope);
  }
}

function assertEnvelope(value: unknown): asserts value is TransitEnvelope {
  assertObject(value, "Transit envelope");
  assertKeys(value, ["ephemeral", "seal"], "Transit envelope");
  requireString(value.ephemeral, "Transit envelope ephemeral key");
  requireString(value.seal, "Transit envelope seal");
  if (!PUBLIC_KEY_PATTERN.test(value.ephemeral)) {
    throw new Error("Transit envelope ephemeral key must be base64 of 32 bytes");
  }
  if (!BASE64_PATTERN.test(value.seal) || value.seal.length < 28) {
    throw new Error("Transit envelope seal must be a non-empty base64 AEAD blob");
  }
}

function requirePublicKey(value: unknown, label: string): void {
  requireString(value, label);
  if (!PUBLIC_KEY_PATTERN.test(value)) {
    throw new Error(`${label} must be base64 of 32 bytes`);
  }
}
