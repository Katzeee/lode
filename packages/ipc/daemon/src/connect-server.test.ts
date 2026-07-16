import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  AuthenticationError,
  DocNotFoundError,
  DomainInvalidInputError,
  NotFoundError,
  NotOwnerError,
  PreconditionFailedError,
  SessionRequiredError,
  VaultLockedError,
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

  it("maps NotFoundError (a missing node/occurrence/entity) → NotFound", () => {
    expect(toConnectError(new NotFoundError("entity", "node-123"))).toMatchObject({
      code: Code.NotFound,
    });
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

  it("maps VaultLockedError → FailedPrecondition with the x-lode-vault-locked marker", () => {
    // The marker (not message wording) is the client's stable signal — both cold and lease-expired
    // carry it, so the client detects vault-locked without a fragile message substring, and the two
    // precondition errors stay distinguishable by the marker alone.
    for (const subtype of ["cold", "lease-expired"] as const) {
      const ce = toConnectError(new VaultLockedError(subtype));
      expect(ce).toMatchObject({ code: Code.FailedPrecondition });
      expect(ce.metadata.get("x-lode-vault-locked")).toBe("1");
    }
  });

  it("does NOT attach the vault-locked marker to a plain PreconditionFailedError", () => {
    const ce = toConnectError(new PreconditionFailedError("not ready"));
    expect(ce.metadata.get("x-lode-vault-locked")).toBeNull();
  });

  it("falls back to Internal for an unknown error", () => {
    expect(toConnectError(new Error("something else"))).toMatchObject({ code: Code.Internal });
  });
});
