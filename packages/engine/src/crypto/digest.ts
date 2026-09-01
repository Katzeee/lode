import { sha256 } from "@noble/hashes/sha2.js";

import { bytesToHex } from "./bytes.js";

export function sha256Bytes(value: Uint8Array): Uint8Array {
  return sha256(value);
}

export function sha256Hex(value: Uint8Array): string {
  return bytesToHex(sha256Bytes(value));
}
