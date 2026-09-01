import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { commandExecutionOutcomeIsUnknown } from "./desktop-client.js";

describe("Desktop command execution failure authority", () => {
  it("marks only delivery-ambiguous transport failures as outcome unknown", () => {
    expect(commandExecutionOutcomeIsUnknown(new ConnectError("transport unavailable", Code.Unavailable))).toBe(true);
    expect(commandExecutionOutcomeIsUnknown(new ConnectError("deadline elapsed", Code.DeadlineExceeded))).toBe(true);
    expect(commandExecutionOutcomeIsUnknown(new ConnectError("request canceled", Code.Canceled))).toBe(true);
  });

  it("keeps definite server responses and local failures observable", () => {
    for (const code of [
      Code.Unauthenticated,
      Code.NotFound,
      Code.PermissionDenied,
      Code.FailedPrecondition,
      Code.Internal,
    ]) {
      expect(commandExecutionOutcomeIsUnknown(new ConnectError("server response", code))).toBe(false);
    }
    expect(commandExecutionOutcomeIsUnknown(new Error("local codec failure"))).toBe(false);
  });
});
