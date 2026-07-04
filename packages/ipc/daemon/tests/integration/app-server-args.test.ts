import { describe, expect, it } from "vitest";
import { parseAppServerArgs } from "../../src/app-server-args.js";

// Pure-function coverage for the CLI parser's TLS surface (the user-facing entry point for the
// relay's opt-in TLS). The validation contract — both-or-neither, requires --relay, no silent
// plaintext on a missing value — is exactly the kind of behavior that should fail on regression.

describe("parseAppServerArgs — TLS flags", () => {
  it("both --tls-cert/--tls-key with --relay (engine mode) thread onto relay", () => {
    const a = parseAppServerArgs([
      "--listen",
      "tcp://127.0.0.1:0",
      "--relay",
      "4193",
      "--tls-cert",
      "/c.pem",
      "--tls-key",
      "/k.pem",
    ]);
    expect(a.mode).toBe("engine");
    if (a.mode !== "engine") {
      throw new Error("engine");
    }
    expect(a.relay).toMatchObject({ port: 4193, tlsCertPath: "/c.pem", tlsKeyPath: "/k.pem" });
  });

  it("both --tls-cert/--tls-key with --relay (relay-only mode) thread onto relay", () => {
    const a = parseAppServerArgs(["--relay", "--tls-cert", "/c.pem", "--tls-key", "/k.pem"]);
    expect(a.mode).toBe("relay");
    if (a.mode !== "relay") {
      throw new Error("relay");
    }
    expect(a.relay).toMatchObject({ tlsCertPath: "/c.pem", tlsKeyPath: "/k.pem" });
  });

  it("only --tls-cert (no --tls-key) throws", () => {
    expect(() => parseAppServerArgs(["--relay", "--tls-cert", "/c.pem"])).toThrow(
      /must be provided together/,
    );
  });

  it("only --tls-key (no --tls-cert) throws", () => {
    expect(() => parseAppServerArgs(["--relay", "--tls-key", "/k.pem"])).toThrow(
      /must be provided together/,
    );
  });

  it("both flags present but a value missing throws (not silent plaintext)", () => {
    // valueAfter returns undefined when the next token is a flag — without the bare-flag presence
    // check this would silently start a plaintext relay.
    expect(() => parseAppServerArgs(["--relay", "--tls-cert", "--tls-key"])).toThrow(
      /require a value/,
    );
    expect(() => parseAppServerArgs(["--tls-cert", "--relay", "--tls-key", "/k.pem"])).toThrow(
      /require a value/,
    );
  });

  it("both provided without --relay throws", () => {
    expect(() =>
      parseAppServerArgs([
        "--listen",
        "tcp://127.0.0.1:0",
        "--tls-cert",
        "/c.pem",
        "--tls-key",
        "/k.pem",
      ]),
    ).toThrow(/require --relay/);
  });

  it("no TLS flags → relay has no tlsCertPath/tlsKeyPath (plaintext h2c)", () => {
    const a = parseAppServerArgs(["--relay", "4193"]);
    if (a.mode !== "relay") {
      throw new Error("relay");
    }
    expect(a.relay?.tlsCertPath).toBeUndefined();
    expect(a.relay?.tlsKeyPath).toBeUndefined();
  });
});
