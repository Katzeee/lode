import type { AuthedHandler, Handler, OpenHandler } from "./handler.js";
import type { SessionIdentity } from "../runtime/identity/session-identity.js";

/** A command bag of self-declaring handlers (each `authed(...)` or `open(...)`). `req` is `never` so
 *  a bag of differently-typed handlers satisfies the constraint (each keeps its own request type). */
type HandlerBag = Record<string, Handler<never, unknown>>;

type WrapOne<H> =
  H extends AuthedHandler<infer Req, infer R>
    ? (req: Req, connectionId: string) => R
    : H extends OpenHandler<infer Req, infer R>
      ? (req: Req, connectionId: string) => R
      : never;

/** Wrap a handler bag so transports invoke `(req, connectionId) => R`: each handler's own `authed`
 *  flag (co-located, not an external list) decides whether the boundary resolves the caller first.
 *  Reached identically by the daemon socket transport and the engine-free in-process transport (the
 *  single place that holds the connectionId → session mapping). The mapped type preserves each
 *  handler's request + return types so the Connect router's typed dispatch still type-checks. */
export type WrappedCommands<T extends HandlerBag> = {
  [K in keyof T]: WrapOne<T[K]>;
};

export function wrapCommands<T extends HandlerBag>(
  raw: T,
  identity: SessionIdentity,
): WrappedCommands<T> {
  const out: Record<string, (req: unknown, connectionId: string) => unknown> = {};
  for (const [name, handler] of Object.entries(raw)) {
    out[name] = handler.authed
      ? (req: unknown, connectionId: string) =>
          handler.invoke(req as never, identity.resolveCaller(connectionId), connectionId)
      : (req: unknown, connectionId: string) => handler.invoke(req as never, connectionId);
  }
  return out as unknown as WrappedCommands<T>;
}
