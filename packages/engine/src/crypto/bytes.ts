import { Buffer } from "buffer";

export function bytesToBase64(value: Uint8Array): string {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64");
}

export function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

export function bytesToHex(value: Uint8Array): string {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex");
}

export function hexToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "hex"));
}

export function isBase64Bytes(value: unknown, length?: number): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }
  const bytes = Buffer.from(value, "base64");
  return length === undefined || bytes.length === length;
}

export function concatenateBytes(values: readonly Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}
