import { describe, expect, it } from "vitest";
import { parseCli } from "./args.js";

describe("parseCli", () => {
  it("parses url, command, flags and ordered value flags", () => {
    const parsed = parseCli([
      "--url",
      "http://localhost:8080",
      "--actor",
      "alice",
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
      actorId: "alice",
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

  it("uses LODE_URL when --url is absent", () => {
    const previousUrl = process.env.LODE_URL;
    const previousActor = process.env.LODE_ACTOR;
    const previousMnemonic = process.env.LODE_ACTOR_MNEMONIC;
    process.env.LODE_URL = "http://from-env:8080";
    process.env.LODE_ACTOR = "env-actor";
    process.env.LODE_ACTOR_MNEMONIC = "env words";

    try {
      const parsed = parseCli(["workspace", "list"]);
      expect(parsed.url).toBe("http://from-env:8080");
      expect(parsed.actorId).toBe("env-actor");
      expect(parsed.actorMnemonic).toBe("env words");
    } finally {
      process.env.LODE_URL = previousUrl;
      process.env.LODE_ACTOR = previousActor;
      process.env.LODE_ACTOR_MNEMONIC = previousMnemonic;
    }
  });

  it("uses LODE_ACTOR when --actor is absent", () => {
    const previous = process.env.LODE_ACTOR;
    process.env.LODE_ACTOR = "env-actor";

    try {
      const parsed = parseCli(["--url", "http://localhost:8080", "workspace", "list"]);
      expect(parsed.actorId).toBe("env-actor");
    } finally {
      process.env.LODE_ACTOR = previous;
    }
  });

  it("treats actor as optional (the bootstrap `actor new` has none; enforced by bin/lode.ts)", () => {
    const previous = process.env.LODE_ACTOR;
    const previousMnemonic = process.env.LODE_ACTOR_MNEMONIC;
    delete process.env.LODE_ACTOR;
    delete process.env.LODE_ACTOR_MNEMONIC;

    try {
      const parsed = parseCli(["--url", "http://localhost:8080", "workspace", "list"]);
      expect(parsed.actorId).toBeUndefined();
      expect(parsed.actorMnemonic).toBeUndefined();
    } finally {
      process.env.LODE_ACTOR = previous;
      process.env.LODE_ACTOR_MNEMONIC = previousMnemonic;
    }
  });

  it("throws clear error for missing url", () => {
    const previousUrl = process.env.LODE_URL;
    const previousActor = process.env.LODE_ACTOR;
    delete process.env.LODE_URL;
    process.env.LODE_ACTOR = "actor";

    try {
      expect(() => parseCli(["workspace", "list"])).toThrow(/Missing server URL/);
    } finally {
      process.env.LODE_URL = previousUrl;
      process.env.LODE_ACTOR = previousActor;
    }
  });

  it("throws clear error for malformed flags", () => {
    expect(() =>
      parseCli(["--url", "http://localhost:8080", "--actor", "alice", "workspace", "list", "-bad"]),
    ).toThrow(/Malformed flag/);
  });

  it("throws clear error for missing flag values", () => {
    expect(() =>
      parseCli([
        "--url",
        "http://localhost:8080",
        "--actor",
        "alice",
        "workspace",
        "create",
        "--name",
      ]),
    ).toThrow(/requires a value/);
  });
});
