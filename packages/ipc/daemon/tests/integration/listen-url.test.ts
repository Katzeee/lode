import { describe, expect, it } from "vitest";
import { parseListenUrl } from "../../src/listen-url.js";

describe("parseListenUrl", () => {
  it("parses a tcp host and port", () => {
    expect(parseListenUrl("tcp://127.0.0.1:1234")).toEqual({ host: "127.0.0.1", port: 1234 });
  });

  it("defaults host and port when tcp:// is bare", () => {
    expect(parseListenUrl("tcp://")).toEqual({ host: "127.0.0.1", port: 0 });
  });

  it("rejects unsupported schemes", () => {
    expect(() => parseListenUrl("unix:///tmp/lode.sock")).toThrow("Unsupported listen protocol");
  });
});
