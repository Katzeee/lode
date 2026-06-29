import { describe, expect, it } from "vitest";
import { deriveEd25519Node, deriveEd25519Seed } from "./slip10.js";

// SLIP-0010 test vector 1 (ed25519). Seed: 000102030405060708090a0b0c0d0e0f
const SEED = Uint8Array.from(Buffer.from("000102030405060708090a0b0c0d0e0f", "hex"));

const h = (i: number): number => i + 0x80000000;

describe("slip10 ed25519 (SLIP-0010 test vector 1)", () => {
  it("derives the master node m (key + chain code)", () => {
    const n = deriveEd25519Node(SEED, []);
    expect(Buffer.from(n.key).toString("hex")).toBe(
      "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7",
    );
    expect(Buffer.from(n.chainCode).toString("hex")).toBe(
      "90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb",
    );
  });

  it("derives m/0H", () => {
    const n = deriveEd25519Node(SEED, [h(0)]);
    expect(Buffer.from(n.key).toString("hex")).toBe(
      "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3",
    );
    expect(Buffer.from(n.chainCode).toString("hex")).toBe(
      "8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69",
    );
  });

  it("derives m/0H/1H", () => {
    const n = deriveEd25519Node(SEED, [h(0), h(1)]);
    expect(Buffer.from(n.key).toString("hex")).toBe(
      "b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2",
    );
    expect(Buffer.from(n.chainCode).toString("hex")).toBe(
      "a320425f77d1b5c2505a6b1b27382b37368ee640e3557c315416801243552f14",
    );
  });

  it("derives m/0H/1H/2H", () => {
    const n = deriveEd25519Node(SEED, [h(0), h(1), h(2)]);
    expect(Buffer.from(n.key).toString("hex")).toBe(
      "92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9",
    );
    expect(Buffer.from(n.chainCode).toString("hex")).toBe(
      "2e69929e00b5ab250f49c3fb1c12f252de4fed2c1db88387094a0f8c4c9ccd6c",
    );
  });

  it("derives m/0H/1H/2H/2H (deep path, large child index in later cases)", () => {
    const n = deriveEd25519Node(SEED, [h(0), h(1), h(2), h(2)]);
    expect(Buffer.from(n.key).toString("hex")).toBe(
      "30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662",
    );
    expect(Buffer.from(n.chainCode).toString("hex")).toBe(
      "8f6d87f93d750e0efccda017d662a1b31a266e4a6f5993b15f5c1f07f74dd5cc",
    );
  });

  it("lode actor path m/44'/2026'/0'/0'/0' is pinned to a known answer (catches path-wiring drift)", () => {
    // Pinned, not self-referential: the master+child math is KAT-validated above against SLIP-0010
    // vector 1; this asserts the purpose/coin-type/account/index ASSEMBLY is correct. A path typo
    // (e.g. m/44'/2026'/0'/0'/1') would change this hex and fail here.
    expect(Buffer.from(deriveEd25519Seed(SEED)).toString("hex")).toBe(
      "1b53cce15cf32a43d50ef933db61b5d419c7a043cda941ddd291b1f47bb967b4",
    );
  });
});
