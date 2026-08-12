import { randomBytes } from "node:crypto";

import { isReplicaId, type ReplicaId } from "../../domain/fact/index.js";

export function createReplicaId(): ReplicaId {
  return encodeBase32(randomBytes(16));
}

export function validateReplicaId(replicaId: ReplicaId): void {
  if (!isReplicaId(replicaId)) {
    throw new Error("ReplicaId must be a 128-bit lowercase base32 value");
  }
}

function encodeBase32(bytes: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}
