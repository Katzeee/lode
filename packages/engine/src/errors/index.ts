// Engine-internal typed errors. A neutral leaf every engine layer may import (commands, runtime,
// the in-process sync core). These carry no wire/error-code knowledge — the daemon (Connect layer)
// maps them to Connect status codes + details; in-process callers (mobile) handle them directly.
// Keeping them out of `commands/` restores the one-way DAG: lower layers (the sync core in
// `runtime/`) no longer reach up into the RPC adapter for their error types.
// (SessionRequiredError stays co-located with its thrower in runtime/session/client-session-manager.ts;
// the domain-specific DomainInvalidInputError stays in domain/errors.ts.)

export class DocNotFoundError extends Error {
  readonly workspaceId: string;

  constructor(workspaceId: string) {
    super(`Doc not found for workspace: ${workspaceId}`);
    this.name = "DocNotFoundError";
    this.workspaceId = workspaceId;
  }
}

/** What kind of thing the store looked up and didn't find. */
export type NotFoundKind = "entity" | "occurrence" | "canonical" | "content" | "props" | "meta";

/** A node entity / occurrence / canonical / content / props / meta the store looked up by id and
 *  didn't find. THE single "not found" signal from core — typed, so callers (`getNodeById`,
 *  `getEntitySnapshot`, the daemon) match on `instanceof NotFoundError`, never on message text. The
 *  daemon maps it to Connect `Code.NotFound`. */
export class NotFoundError extends Error {
  constructor(
    readonly kind: NotFoundKind,
    readonly id: string,
  ) {
    super(`${kind} not found: ${id}`);
    this.name = "NotFoundError";
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
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
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

/** The identity vault is not unlocked, so an authed command cannot get its actor keypair. The daemon
 *  maps this to Connect `Code.FailedPrecondition` and attaches a stable `x-lode-vault-locked` trailer
 *  marker the client detects (NOT the message wording). `subtype` is engine-internal — for daemon-side
 *  logging only; the client chooses passphrase vs PIN via `getVaultStatus`, never via the subtype. */
export class VaultLockedError extends Error {
  readonly subtype: "cold" | "lease-expired";
  constructor(subtype: "cold" | "lease-expired" = "cold") {
    super(`vault locked (${subtype})`);
    this.name = "VaultLockedError";
    this.subtype = subtype;
  }
}
