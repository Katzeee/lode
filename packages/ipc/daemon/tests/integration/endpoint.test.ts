import { describe, expect, it } from "vitest";
import {
  canonicalAddress,
  defaultEndpoint,
  dialTarget,
  listenTarget,
  parseEndpoint,
  socketPathOf,
} from "../../src/endpoint.js";

// Locks in the single owner of endpoint syntax (L1): the scheme grammar, the listen shape, the dial
// descriptor, the canonical address, the default endpoint, and stale-socket path extraction. No other
// module duplicates any of this.
describe("parseEndpoint", () => {
  it("parses a tcp host and port", () => {
    expect(parseEndpoint("tcp://127.0.0.1:1234")).toEqual({
      scheme: "tcp",
      host: "127.0.0.1",
      port: 1234,
    });
  });

  it("accepts http:// as tcp (the canonical TCP address form)", () => {
    expect(parseEndpoint("http://127.0.0.1:4193")).toEqual({
      scheme: "tcp",
      host: "127.0.0.1",
      port: 4193,
    });
  });

  it("defaults host and port when tcp:// is bare", () => {
    expect(parseEndpoint("tcp://")).toEqual({ scheme: "tcp", host: "127.0.0.1", port: 0 });
  });

  it("parses a unix domain socket path", () => {
    expect(parseEndpoint("unix:///home/x/lode/daemon.sock")).toEqual({
      scheme: "unix",
      socketPath: "/home/x/lode/daemon.sock",
    });
  });

  it("parses a Windows named pipe (name only, not the \\\\.\\pipe\\ form)", () => {
    expect(parseEndpoint("pipe://lode-abc")).toEqual({ scheme: "pipe", pipeName: "lode-abc" });
  });

  it("rejects unsupported schemes", () => {
    expect(() => parseEndpoint("foo://x")).toThrow("Unsupported endpoint protocol");
  });

  it("rejects a unix:// without a path", () => {
    expect(() => parseEndpoint("unix://")).toThrow("requires a path");
  });

  it("rejects a pipe:// without a name", () => {
    expect(() => parseEndpoint("pipe://")).toThrow("requires a pipe name");
  });
});

describe("canonicalAddress", () => {
  it("renders tcp with the bound port", () => {
    expect(canonicalAddress(parseEndpoint("tcp://127.0.0.1:0"), 4193)).toBe(
      "http://127.0.0.1:4193",
    );
  });

  it("renders unix from the socket path (round-trips through parseEndpoint)", () => {
    expect(canonicalAddress(parseEndpoint("unix:///tmp/x.sock"), 0)).toBe("unix:///tmp/x.sock");
  });

  it("renders pipe from the name (round-trips through parseEndpoint)", () => {
    expect(canonicalAddress(parseEndpoint("pipe://lode-abc"), 0)).toBe("pipe://lode-abc");
  });
});

describe("listenTarget", () => {
  it("renders a unix socket as { path }", () => {
    expect(listenTarget(parseEndpoint("unix:///tmp/x.sock"))).toEqual({ path: "/tmp/x.sock" });
  });

  it("renders a Windows pipe as the \\\\.\\pipe\\ path", () => {
    expect(listenTarget(parseEndpoint("pipe://lode-abc"))).toEqual({
      path: "\\\\.\\pipe\\lode-abc",
    });
  });

  it("renders tcp as { host, port }", () => {
    expect(listenTarget(parseEndpoint("tcp://127.0.0.1:1234"))).toEqual({
      host: "127.0.0.1",
      port: 1234,
    });
  });
});

describe("dialTarget", () => {
  it("renders tcp as a tcpUrl (the client dials the URL itself)", () => {
    expect(dialTarget("tcp://127.0.0.1:1234")).toEqual({ tcpUrl: "http://127.0.0.1:1234" });
  });

  it("renders a unix socket as { authority, createConnection }", () => {
    const dial = dialTarget("unix:///tmp/x.sock");
    expect("tcpUrl" in dial).toBe(false);
    if (!("tcpUrl" in dial)) {
      expect(dial.authority).toBe("http://lode.local");
      expect(typeof dial.createConnection).toBe("function");
    }
  });

  it("renders a Windows pipe as { authority, createConnection }", () => {
    const dial = dialTarget("pipe://lode-abc");
    expect("tcpUrl" in dial).toBe(false);
    if (!("tcpUrl" in dial)) {
      expect(dial.authority).toBe("http://lode.local");
      expect(typeof dial.createConnection).toBe("function");
    }
  });
});

describe("socketPathOf", () => {
  it("returns the path for a unix endpoint", () => {
    expect(socketPathOf("unix:///tmp/x.sock")).toBe("/tmp/x.sock");
  });

  it("returns undefined for a pipe / tcp endpoint", () => {
    expect(socketPathOf("pipe://lode-abc")).toBeUndefined();
    expect(socketPathOf("http://127.0.0.1:4193")).toBeUndefined();
  });

  it("never throws on garbage", () => {
    expect(socketPathOf("not-an-endpoint")).toBeUndefined();
  });
});

describe("defaultEndpoint", () => {
  it("yields a unix socket under the home on POSIX", () => {
    // The default endpoint is platform-dependent; on every POSIX CI runner this is the UDS form.
    if (process.platform === "win32") {
      expect(defaultEndpoint("/h")).toMatch(/^pipe:\/\/lode-[0-9a-f]{16}$/);
    } else {
      expect(defaultEndpoint("/home/x/lode")).toBe("unix:///home/x/lode/daemon.sock");
    }
  });
});
