import type { ResolvedCaller } from "../runtime/identity/caller.js";

/**
 * A command handler's self-declared auth contract — the auth requirement lives WITH the handler, not
 * in an external mirror list. `authed` handlers receive a non-null caller (the boundary resolves it
 * from the connectionId + throws on no session); `open` handlers take none (bootstrap, open reads,
 * the notification stream).
 *
 * The constructors' fn types are deliberately INCOMPATIBLE: `authed`'s 2nd param is `ResolvedCaller`,
 * `open`'s is `connectionId: string`. So a caller-using handler mislabeled `open` (or vice versa) is a
 * compile error, and an unwrapped handler doesn't satisfy the command bag type — a new RPC MUST pick
 * one. Lives at the src root (a neutral leaf) because services handlers construct these at definition
 * time; putting them in runtime/ would re-introduce services→runtime.
 */
export type AuthedHandler<Req, R> = {
  readonly authed: true;
  invoke(req: Req, caller: ResolvedCaller, connectionId: string): R;
};
export type OpenHandler<Req, R> = {
  readonly authed: false;
  invoke(req: Req, connectionId: string): R;
};
export type Handler<Req, R> = AuthedHandler<Req, R> | OpenHandler<Req, R>;

/** Mark a handler as authenticated: it receives a non-null `caller` (the boundary resolves it). The
 *  fn may omit the trailing `connectionId` (only connection-aware authed handlers — subscribe/
 *  unsubscribe — declare it). */
export function authed<Req, R>(
  fn: (req: Req, caller: ResolvedCaller, connectionId: string) => R,
): AuthedHandler<Req, R> {
  return { authed: true, invoke: fn };
}

/** Mark a handler as open (no session required): it takes no caller. The fn may omit the trailing
 *  `connectionId`. */
export function open<Req, R>(fn: (req: Req, connectionId: string) => R): OpenHandler<Req, R> {
  return { authed: false, invoke: fn };
}
