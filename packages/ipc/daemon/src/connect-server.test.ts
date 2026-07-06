import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  AuthenticationError,
  DocNotFoundError,
  DomainInvalidInputError,
  NotOwnerError,
  PreconditionFailedError,
  SessionRequiredError,
} from "@lode/engine";
import { toConnectError } from "./connect-server.js";

// The engine stays free of wire/error-code knowledge; `toConnectError` is the one place that maps
// engine typed errors to Connect status. This pins that contract so a thrown type and its code
// don't silently drift (a governance error regressing to Internal would be a user-facing change).

describe("toConnectError", () => {
  it("passes ConnectError through unchanged", () => {
    const err = new ConnectError("nope", Code.ResourceExhausted);
    expect(toConnectError(err)).toBe(err);
  });

  it("maps SessionRequiredError → Unauthenticated", () => {
    expect(toConnectError(new SessionRequiredError())).toMatchObject({
      code: Code.Unauthenticated,
    });
  });

  it("maps AuthenticationError → Unauthenticated", () => {
    expect(toConnectError(new AuthenticationError("bad"))).toMatchObject({
      code: Code.Unauthenticated,
    });
  });

  it("maps NotOwnerError → PermissionDenied (not Unauthenticated, not Internal)", () => {
    expect(toConnectError(new NotOwnerError("only the owner"))).toMatchObject({
      code: Code.PermissionDenied,
    });
  });

  it("maps DocNotFoundError → NotFound", () => {
    expect(toConnectError(new DocNotFoundError("ws"))).toMatchObject({ code: Code.NotFound });
  });

  it("maps DomainInvalidInputError → InvalidArgument", () => {
    expect(toConnectError(new DomainInvalidInputError("bad input"))).toMatchObject({
      code: Code.InvalidArgument,
    });
  });

  it("maps PreconditionFailedError → FailedPrecondition", () => {
    expect(toConnectError(new PreconditionFailedError("not ready"))).toMatchObject({
      code: Code.FailedPrecondition,
    });
  });

  it("falls back to Internal for an unknown error", () => {
    expect(toConnectError(new Error("something else"))).toMatchObject({ code: Code.Internal });
  });
});
