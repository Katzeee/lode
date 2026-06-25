import { describe, expect, it } from "vitest";
import { parseCli } from "./args.js";

describe("parseCli", () => {
  it("parses url, command, flags and ordered value flags", () => {
    const parsed = parseCli([
      "--url",
      "http://localhost:8080",
      "--actor",
      "alice",
      "field",
      "set-values",
      "--doc",
      "doc_main",
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
      group: "field",
      action: "set-values",
      flags: {
        "--doc": ["doc_main"],
        "--field-occ": ["occ_field"],
        "--text": ["a", "c"],
        "--ref-node": ["node_b"],
      },
      orderedFlags: [
        { name: "--doc", value: "doc_main" },
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
    process.env.LODE_URL = "http://from-env:8080";
    process.env.LODE_ACTOR = "env-actor";

    try {
      const parsed = parseCli(["doc", "list"]);
      expect(parsed.url).toBe("http://from-env:8080");
      expect(parsed.actorId).toBe("env-actor");
    } finally {
      process.env.LODE_URL = previousUrl;
      process.env.LODE_ACTOR = previousActor;
    }
  });

  it("uses LODE_ACTOR when --actor is absent", () => {
    const previous = process.env.LODE_ACTOR;
    process.env.LODE_ACTOR = "env-actor";

    try {
      const parsed = parseCli(["--url", "http://localhost:8080", "doc", "list"]);
      expect(parsed.actorId).toBe("env-actor");
    } finally {
      process.env.LODE_ACTOR = previous;
    }
  });

  it("throws clear error for missing actor", () => {
    const previous = process.env.LODE_ACTOR;
    delete process.env.LODE_ACTOR;

    try {
      expect(() => parseCli(["--url", "http://localhost:8080", "doc", "list"])).toThrow(
        /Missing actor/,
      );
    } finally {
      process.env.LODE_ACTOR = previous;
    }
  });

  it("throws clear error for missing url", () => {
    const previousUrl = process.env.LODE_URL;
    const previousActor = process.env.LODE_ACTOR;
    delete process.env.LODE_URL;
    process.env.LODE_ACTOR = "actor";

    try {
      expect(() => parseCli(["doc", "list"])).toThrow(/Missing server URL/);
    } finally {
      process.env.LODE_URL = previousUrl;
      process.env.LODE_ACTOR = previousActor;
    }
  });

  it("throws clear error for malformed flags", () => {
    expect(() =>
      parseCli(["--url", "http://localhost:8080", "--actor", "alice", "doc", "list", "-bad"]),
    ).toThrow(/Malformed flag/);
  });

  it("throws clear error for missing flag values", () => {
    expect(() =>
      parseCli(["--url", "http://localhost:8080", "--actor", "alice", "doc", "remove", "--doc"]),
    ).toThrow(/requires a value/);
  });
});
