import { describe, expect, it } from "vitest";

import { generateSigningKeyPair, signBytes, verifyBytes } from "./keys.js";

describe("signing keys", () => {
  it("distinguishes valid signatures, cryptographic mismatches, and invalid lengths", () => {
    const message = new TextEncoder().encode("signed payload");
    const other = new TextEncoder().encode("other payload");
    const keyPair = generateSigningKeyPair();
    const otherKeyPair = generateSigningKeyPair();
    const signature = signBytes(message, keyPair.seed);

    expect(verifyBytes(message, signature, keyPair.publicKey)).toBe(true);
    expect(verifyBytes(other, signature, keyPair.publicKey)).toBe(false);
    expect(verifyBytes(message, signature, otherKeyPair.publicKey)).toBe(false);
    expect(verifyBytes(message, signature.subarray(1), keyPair.publicKey)).toBe(false);
  });
});
