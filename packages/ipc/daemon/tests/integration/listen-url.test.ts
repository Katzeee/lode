import { describe, expect, it } from "vitest";
import { canonicalAddress, parseListenUrl } from "../../src/listen-url.js";

describe("parseListenUrl", () => {
  it("parses a tcp host and port", () => {
    expect(parseListenUrl("tcp://127.0.0.1:1234")).toEqual({
      kind: "tcp",
      host: "127.0.0.1",
      port: 1234,
    });
  });

  it("defaults host and port when tcp:// is bare", () => {
    expect(parseListenUrl("tcp://")).toEqual({ kind: "tcp", host: "127.0.0.1", port: 0 });
  });

  it("parses a unix domain socket path", () => {
    expect(parseListenUrl("unix:///home/x/lode/daemon.sock")).toEqual({
      kind: "unix",
      path: "/home/x/lode/daemon.sock",
    });
  });

  it("parses a Windows named pipe", () => {
    expect(parseListenUrl("pipe://lode-abc")).toEqual({
      kind: "pipe",
      path: "\\\\.\\pipe\\lode-abc",
    });
  });

  it("rejects unsupported schemes", () => {
    expect(() => parseListenUrl("foo://x")).toThrow("Unsupported listen protocol");
  });

  it("rejects a unix:// without a path", () => {
    expect(() => parseListenUrl("unix://")).toThrow("requires a path");
  });
});

describe("canonicalAddress", () => {
  it("renders tcp with the bound port", () => {
    expect(canonicalAddress({ kind: "tcp", host: "127.0.0.1", port: 0 }, 4193)).toBe(
      "http://127.0.0.1:4193",
    );
  });

  it("renders unix from the path", () => {
    expect(canonicalAddress({ kind: "unix", path: "/tmp/x.sock" }, 0)).toBe("unix:///tmp/x.sock");
  });

  it("renders pipe from the name", () => {
    expect(canonicalAddress({ kind: "pipe", path: "\\\\.\\pipe\\lode-abc" }, 0)).toBe(
      "pipe://lode-abc",
    );
  });
});
