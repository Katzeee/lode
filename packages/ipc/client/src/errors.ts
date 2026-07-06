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
      return `Precondition not met: ${detail}`;
    }
    if (error.code === Code.PermissionDenied) {
      return `Permission denied: ${detail}`;
    }
  }
  return detail;
}
