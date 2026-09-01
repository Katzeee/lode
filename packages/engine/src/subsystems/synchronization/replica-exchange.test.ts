import { describe, expect, it } from "vitest";

import { decodeProfile } from "./replica-exchange.js";

describe("remote replica profile decoding", () => {
  it("rejects a non-canonical remote version", () => {
    expect(() => decodeProfile(profile([{ documentId: "facts", version: "!!!!" }]))).toThrow(
      "Remote profile version is not canonical base64",
    );
  });

  it("rejects duplicate document identities", () => {
    expect(() =>
      decodeProfile(
        profile([
          { documentId: "facts", version: "" },
          { documentId: "facts", version: "AQ==" },
        ]),
      ),
    ).toThrow("Remote profile repeats document identity facts");
  });
});

function profile(entries: readonly Readonly<{ documentId: string; version: string }>[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ entries }));
}
