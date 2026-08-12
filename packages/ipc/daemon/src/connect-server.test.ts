import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { toConnectError } from "./connect-server.js";

describe("daemon transport error boundary", () => {
  it("keeps transport errors outside the Engine contract", () => {
    const error = toConnectError(new Error("transport failed"));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("transport failed");
  });
});
