import { randomBytes as secureRandomBytes } from "@noble/hashes/utils.js";

export function randomBytes(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error(`Random byte length must be a non-negative safe integer: ${length}`);
  }
  return secureRandomBytes(length);
}

export function randomUuid(): string {
  const bytes = randomBytes(16);
  const byte6 = bytes[6];
  const byte8 = bytes[8];
  if (byte6 === undefined || byte8 === undefined) {
    throw new Error("UUID entropy source returned too few bytes");
  }
  bytes[6] = (byte6 & 0x0f) | 0x40;
  bytes[8] = (byte8 & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function randomUnsigned64(): bigint {
  const bytes = randomBytes(8);
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}
