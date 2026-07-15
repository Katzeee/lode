import { describe, expect, it } from "vitest";
import { parseCli } from "./args.js";

describe("parseCli", () => {
  it("parses url, actor, command, flags and ordered value flags", () => {
    const parsed = parseCli([
      "--url",
      "http://localhost:8080",
      "--actor",
      "actor-123",
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
      noAutospawn: false,
      actor: "actor-123",
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
      daemonArgs: [],
    });
  });

  it("uses LODE_URL when --url is absent", () => {
    const previousUrl = process.env.LODE_URL;
    process.env.LODE_URL = "http://from-env:8080";
    try {
      const parsed = parseCli(["workspace", "list"]);
      expect(parsed.url).toBe("http://from-env:8080");
    } finally {
      process.env.LODE_URL = previousUrl;
    }
  });

  it("treats url + actor as optional (endpoint resolves from LODE_HOME)", () => {
    const previousUrl = process.env.LODE_URL;
    delete process.env.LODE_URL;
    try {
      const parsed = parseCli(["workspace", "list"]);
      expect(parsed.url).toBeUndefined();
      expect(parsed.actor).toBeUndefined();
    } finally {
      process.env.LODE_URL = previousUrl;
    }
  });

  it("parses global --home and --no-autospawn anywhere", () => {
    const parsed = parseCli(["workspace", "create", "--home", "/tmp/lode", "--no-autospawn"]);
    expect(parsed.home).toBe("/tmp/lode");
    expect(parsed.noAutospawn).toBe(true);
  });

  it("allows a bare verb (no action) — e.g. `lode unlock`", () => {
    const parsed = parseCli(["unlock"]);
    expect(parsed.group).toBe("unlock");
    expect(parsed.action).toBe("");
  });

  it("passes the daemon group's flags through verbatim (incl. boolean --relay)", () => {
    const parsed = parseCli([
      "daemon",
      "run",
      "--listen",
      "tcp://127.0.0.1:0",
      "--relay",
      "--data-root",
      "/tmp/x",
    ]);
    expect(parsed.group).toBe("daemon");
    expect(parsed.action).toBe("run");
    expect(parsed.daemonArgs).toEqual([
      "--listen",
      "tcp://127.0.0.1:0",
      "--relay",
      "--data-root",
      "/tmp/x",
    ]);
    expect(parsed.flags).toEqual({});
  });

  it("throws clear error for malformed flags", () => {
    expect(() => parseCli(["--url", "http://localhost:8080", "workspace", "list", "-bad"])).toThrow(
      /Malformed flag/,
    );
  });

  it("throws clear error for missing non-daemon flag values", () => {
    expect(() =>
      parseCli(["--url", "http://localhost:8080", "workspace", "create", "--name"]),
    ).toThrow(/requires a value/);
  });
});
