// Engine-internal typed errors. A neutral leaf every engine layer may import (services, runtime,
// session, the in-process sync core). These carry no wire/error-code knowledge — the daemon
// (Connect layer) maps them to Connect status codes + details; in-process callers (mobile) handle
// them directly. Keeping them out of `services/` restores the one-way DAG: lower layers (the sync
// core in `runtime/`) no longer reach up into the RPC adapter for their error types.
// (SessionRequiredError stays co-located with its thrower in session/session-manager.ts; the
// domain-specific DomainInvalidInputError stays in domain/errors.ts.)

export class DocNotFoundError extends Error {
  readonly workspaceId: string;

  constructor(workspaceId: string) {
    super(`Doc not found for workspace: ${workspaceId}`);
    this.name = "DocNotFoundError";
    this.workspaceId = workspaceId;
  }
}

/** An authentication failure — bad credentials (e.g. an unparseable/invalid mnemonic at
 *  `sessionHello`). The daemon maps this to Connect `Code.Unauthenticated`. */
export class AuthenticationError extends Error {
  constructor(message = "authentication failed") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** A precondition for the operation is not met (workspace not loaded, sync not registered / stopped,
 *  a conflicting relay, a governance rule that blocks the op). The daemon maps this to Connect
 *  `Code.FailedPrecondition`. */
export class PreconditionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreconditionFailedError";
  }
}

/** The caller is authenticated but lacks governance authority for the op — i.e. a non-owner tried
 *  an owner-only workspace operation. The daemon maps this to Connect `Code.PermissionDenied`
 *  (distinct from `AuthenticationError` → `Unauthenticated`, which is an identity failure). */
export class NotOwnerError extends Error {
  constructor(message = "only the workspace owner may perform this operation") {
    super(message);
    this.name = "NotOwnerError";
  }
}
