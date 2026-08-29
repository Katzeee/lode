import { describe, expect, it } from "vitest";

import { parseEndpoint } from "./endpoint.js";

describe("endpoint syntax", () => {
  it("parses every supported listener and dialer scheme", () => {
    expect(parseEndpoint("tcp://127.0.0.1:5100")).toEqual({ scheme: "tcp", host: "127.0.0.1", port: 5100 });
    expect(parseEndpoint("http://localhost:5200")).toEqual({ scheme: "tcp", host: "localhost", port: 5200 });
    expect(parseEndpoint("unix:///tmp/lode.sock")).toEqual({ scheme: "unix", socketPath: "/tmp/lode.sock" });
    expect(parseEndpoint("pipe://lode-main")).toEqual({ scheme: "pipe", pipeName: "lode-main" });
  });

  it("rejects unsupported and incomplete addresses", () => {
    expect(() => parseEndpoint("not an endpoint")).toThrow("Invalid endpoint");
    expect(() => parseEndpoint("https://localhost:5100")).toThrow("Unsupported endpoint protocol");
    expect(() => parseEndpoint("unix://")).toThrow("requires a path");
    expect(() => parseEndpoint("pipe://")).toThrow("requires a pipe name");
  });
});
