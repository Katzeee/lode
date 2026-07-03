import { describe, expect, it } from "vitest";
import { parseCli } from "./args.js";

describe("parseCli", () => {
  it("parses url, mnemonic, command, flags and ordered value flags", () => {
    const parsed = parseCli([
      "--url",
      "http://localhost:8080",
      "--actor-mnemonic",
      "test words",
      "field",
      "set-values",
      "--field-occ",
      "occ_field",
      "--text",
      "a",
      "--ref-node",
      "node_b",
      "--text",
      "c",
    ]);

    expect(parsed).toEqual({
      url: "http://localhost:8080",
      actorMnemonic: "test words",
      group: "field",
      action: "set-values",
      flags: {
        "--field-occ": ["occ_field"],
        "--text": ["a", "c"],
        "--ref-node": ["node_b"],
      },
      orderedFlags: [
        { name: "--field-occ", value: "occ_field" },
        { name: "--text", value: "a" },
        { name: "--ref-node", value: "node_b" },
        { name: "--text", value: "c" },
      ],
    });
  });

  it("uses LODE_URL / LODE_ACTOR_MNEMONIC when the flags are absent", () => {
    const previousUrl = process.env.LODE_URL;
    const previousMnemonic = process.env.LODE_ACTOR_MNEMONIC;
    process.env.LODE_URL = "http://from-env:8080";
    process.env.LODE_ACTOR_MNEMONIC = "env words";

    try {
      const parsed = parseCli(["workspace", "list"]);
      expect(parsed.url).toBe("http://from-env:8080");
      expect(parsed.actorMnemonic).toBe("env words");
    } finally {
      process.env.LODE_URL = previousUrl;
      process.env.LODE_ACTOR_MNEMONIC = previousMnemonic;
    }
  });

  it("treats the mnemonic as optional (the bootstrap `actor new` has none; enforced by bin/lode.ts)", () => {
    const previousMnemonic = process.env.LODE_ACTOR_MNEMONIC;
    delete process.env.LODE_ACTOR_MNEMONIC;

    try {
      const parsed = parseCli(["--url", "http://localhost:8080", "workspace", "list"]);
      expect(parsed.actorMnemonic).toBeUndefined();
    } finally {
      process.env.LODE_ACTOR_MNEMONIC = previousMnemonic;
    }
  });

  it("throws clear error for missing url", () => {
    const previousUrl = process.env.LODE_URL;
    delete process.env.LODE_URL;

    try {
      expect(() => parseCli(["workspace", "list"])).toThrow(/Missing server URL/);
    } finally {
      process.env.LODE_URL = previousUrl;
    }
  });

  it("throws clear error for malformed flags", () => {
    expect(() => parseCli(["--url", "http://localhost:8080", "workspace", "list", "-bad"])).toThrow(
      /Malformed flag/,
    );
  });

  it("throws clear error for missing flag values", () => {
    expect(() =>
      parseCli(["--url", "http://localhost:8080", "workspace", "create", "--name"]),
    ).toThrow(/requires a value/);
  });
});
