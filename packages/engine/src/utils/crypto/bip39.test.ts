import { describe, expect, it } from "vitest";
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "./bip39.js";

describe("bip39", () => {
  it("generates a 12-word English mnemonic that validates", () => {
    const m = generateMnemonic();
    const words = m.split(" ");
    expect(words).toHaveLength(12);
    expect(validateMnemonic(m)).toBe(true);
  });

  // BIP-39 canonical all-zero-entropy vector: 16 zero bytes → "abandon × 11, about".
  it("derives the canonical 64-byte seed for the all-zero-entropy vector", () => {
    const m =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    expect(validateMnemonic(m)).toBe(true);
    const seed = mnemonicToSeed(m);
    expect(seed).toHaveLength(64);
    expect(Buffer.from(seed).toString("hex")).toBe(
      "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4",
    );
  });

  it("rejects a phrase with a bad checksum (last word swapped)", () => {
    const bad =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon";
    expect(validateMnemonic(bad)).toBe(false);
  });

  it("rejects a phrase with an unknown word", () => {
    expect(
      validateMnemonic("zzzzz zzzzz zzzzz zzzzz zzzzz zzzzz zzzzz zzzzz zzzzz zzzzz zzzzz zzzzz"),
    ).toBe(false);
  });
});
