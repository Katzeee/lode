import { ConnectError, Code } from "@connectrpc/connect";

/**
 * Turn any error — a Connect status from an RPC call, or a plain Error thrown locally — into a
 * user-facing message. The client wraps Connect, so Connect-error classification lives HERE: callers
 * (e.g. the CLI) get an actionable message without depending on `@connectrpc/connect` or knowing its
 * status-code enum. The raw daemon-side detail string is preserved in the message.
 */
export function describeError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (error instanceof ConnectError) {
    if (error.code === Code.Unauthenticated) {
      return `Authentication failed: ${detail}`;
    }
    if (error.code === Code.NotFound) {
      return `Not found: ${detail}`;
    }
    if (error.code === Code.InvalidArgument) {
      return `Invalid input: ${detail}`;
    }
    if (error.code === Code.FailedPrecondition) {
      if (isVaultLockedError(error)) {
        return `Vault locked — run "lode unlock" first (${detail}).`;
      }
      return `Precondition not met: ${detail}`;
    }
    if (error.code === Code.PermissionDenied) {
      return `Permission denied: ${detail}`;
    }
  }
  return detail;
}

/**
 * True if `error` is the daemon's `VaultLockedError` surfaced over Connect: FailedPrecondition carrying
 * the stable `x-lode-vault-locked` trailer marker the daemon's `toConnectError` attaches. Matching on
 * the marker (not a substring of the message) keeps detection robust to message-wording changes. The
 * CLI uses this to trigger the lazy unlock flow; PIN-vs-passphrase is chosen via `getVaultStatus`.
 */
export function isVaultLockedError(error: unknown): boolean {
  return (
    error instanceof ConnectError &&
    error.code === Code.FailedPrecondition &&
    error.metadata.get("x-lode-vault-locked") !== null
  );
}
