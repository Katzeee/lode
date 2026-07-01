import { create } from "@bufbuild/protobuf";
import { WorkspaceCoordinateSchema } from "@lode/protocol/proto";
import { describe, expect, it } from "vitest";
import { decodeCoordinate, encodeCoordinate } from "./coordinate.js";

describe("WorkspaceCoordinate codec", () => {
  it("round-trips through the base64 string form", () => {
    const coord = create(WorkspaceCoordinateSchema, {
      relayUrl: "ws://1.2.3.4:4193",
      workspaceId: "ws-abc",
      docId: "main",
    });
    const encoded = encodeCoordinate(coord);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+={0,2}$/); // base64, one pasteable token (no spaces)
    const decoded = decodeCoordinate(encoded);
    expect({
      relayUrl: decoded.relayUrl,
      workspaceId: decoded.workspaceId,
      docId: decoded.docId,
    }).toEqual({
      relayUrl: "ws://1.2.3.4:4193",
      workspaceId: "ws-abc",
      docId: "main",
    });
  });

  it("is deterministic: the same coordinate encodes identically", () => {
    const make = () =>
      create(WorkspaceCoordinateSchema, { relayUrl: "ws://h:1", workspaceId: "w", docId: "d" });
    expect(encodeCoordinate(make())).toBe(encodeCoordinate(make()));
  });
});
