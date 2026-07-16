import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { createClient, type Client, type Interceptor } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { LodeCommands, type Notification, type SessionInfo } from "@lode/protocol/proto";

export type LodeCommandsClient = Client<typeof LodeCommands>;
export type NotificationHandler = (notification: Notification) => void;

/** How AppServerClient reaches the commands handlers. The daemon injects a socket transport (gRPC
 *  over HTTP/2); an in-process host (mobile/embedded) injects a direct dispatcher over the engine's
 *  `commands`. Both expose the SAME typed LodeCommands surface — the transport is the only
 *  difference between the two client routes. */
export type AppServerTransport = {
  readonly rpc: LodeCommandsClient;
  /** Release transport-owned resources (the HTTP/2 session). No-op for the in-process transport. */
  close(): void;
};

/** A commands handler bag — method name → `(request, connectionId)` handler. This is the engine's
 *  `createCommands` output, typed structurally so `@lode/client` stays free of an engine
 *  dependency; the real (typed) commands object is assignable because every property is a function. */
export type InProcessCommands = Record<string, unknown>;

// The typed client every frontend uses over a pluggable transport; connect()/onNotification() drive
// the server-streaming notification pump.
export class AppServerClient {
  readonly rpc: LodeCommandsClient;
  private notificationIter: AsyncIterator<Notification> | undefined;
  private readonly handlers = new Set<NotificationHandler>();
  private readonly transport: AppServerTransport;

  constructor(transport: AppServerTransport) {
    this.transport = transport;
    this.rpc = transport.rpc;
  }

  // Opens the server-streaming notification channel. Call before onNotification handlers
  // are expected to fire (notifications are dropped server-side until this is open).
  connect(): void {
    this.notificationIter = this.rpc.listenNotifications({})[Symbol.asyncIterator]();
    void this.pumpNotifications();
  }

  /** Submit the mnemonic in `sessionHello`; the daemon derives the identity from it before creating
   *  the session. The caller supplies only the mnemonic — no actor id, no private key material. */
  async authenticate(opts: AuthenticateOptions): Promise<SessionInfo> {
    return this.rpc.sessionHello({
      mnemonic: opts.actorMnemonic,
      client: opts.client,
    });
  }

  private async pumpNotifications(): Promise<void> {
    const iter = this.notificationIter;
    if (iter === undefined) {
      return;
    }
    try {
      while (true) {
        const result = await iter.next();
        if (result.done) {
          break;
        }
        for (const handler of this.handlers) {
          handler(result.value);
        }
      }
    } catch {
      // stream closed or errored — stop pumping
    }
  }

  onNotification(handler: NotificationHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    void this.notificationIter?.return?.();
    this.transport.close();
  }
}

export type AuthenticateOptions = {
  /** The actor's BIP-39 mnemonic; the daemon derives the keypair (identity) server-side. */
  readonly actorMnemonic: string;
  /** Client identity hints surfaced to the daemon (UI surface name + version). */
  readonly client?: { readonly name?: string; readonly version?: string };
};

/** A pre-resolved dial target — what `createSocketTransport` runs gRPC/HTTP-2 over. The client is
 *  scheme-agnostic: it does NOT know whether the channel is a Unix domain socket, a Windows named
 *  pipe, or TCP. The caller (the daemon-side `endpoint.ts`, which owns scheme resolution) hands it
 *  one of:
 *    `{ tcpUrl }`                   plain TCP loopback — `Http2SessionManager` dials the URL itself;
 *    `{ authority, createConnection }` a UDS/pipe — the HTTP/2 session runs over the supplied socket,
 *                                    with `authority` as the `:authority` pseudo-header placeholder.
 *  The field names are the contract between `@lode/client` and `@lode/daemon/endpoint`; the client
 *  owns the type, the daemon produces structurally-matching values. */
export type SocketDial =
  | { readonly tcpUrl: string }
  | { readonly authority: string; readonly createConnection: () => Socket };

/** The socket transport: a Connect gRPC client over an HTTP/2 loopback to the daemon. `headers` (the
 *  socket deployment's per-call identity — `lode-client-id`, `lode-actor-id`) are stamped on every RPC
 *  via an interceptor. */
export function createSocketTransport(
  dial: SocketDial,
  options?: { readonly headers?: Record<string, string> },
): AppServerTransport {
  const sessionManager =
    "tcpUrl" in dial
      ? new Http2SessionManager(dial.tcpUrl)
      : // `createConnection` is passed straight to http2.connect — a UDS/pipe gives a raw Duplex the
        // HTTP/2 session runs over, with a placeholder authority for the `:authority` pseudo-header.
        new Http2SessionManager(dial.authority, undefined, {
          createConnection: dial.createConnection,
        });
  const transport = createGrpcTransport({
    baseUrl: "tcpUrl" in dial ? dial.tcpUrl : dial.authority,
    sessionManager,
    ...(options?.headers === undefined
      ? {}
      : { interceptors: [headerInterceptor(options.headers)] }),
  });
  const client = createClient(LodeCommands, transport);
  return {
    rpc: client,
    close: () => sessionManager.abort(),
  };
}

// A Connect interceptor that stamps fixed headers on every call (the daemon's server interceptor binds
// them to the connection for `resolveCaller`).
function headerInterceptor(headers: Record<string, string>): Interceptor {
  return (next) => async (req) => {
    for (const [name, value] of Object.entries(headers)) {
      req.header.set(name, value);
    }
    return next(req);
  };
}

/** The in-process transport: dispatch each rpc method straight to the same-named commands handler,
 *  threading one stable `connectionId`. Objects pass directly — no proto round-trip — so a
 *  mobile/embedded host gets the same typed client with no socket. The host owns session lifecycle:
 *  `sessionHello` creates the session for this id, and `sessions.removeConnection(connectionId)`
 *  tears it down (mirroring the daemon's connect-server). */
export function createInProcessTransport(
  commands: InProcessCommands,
  options: { readonly connectionId?: string } = {},
): AppServerTransport & { readonly connectionId: string } {
  const connectionId = options.connectionId ?? randomUUID();
  // The proxy stands in for the Connect client: every property access returns a function that calls
  // the matching commands handler with the captured connectionId. Method names mirror the LodeCommands
  // service 1:1 (enforced by the daemon's connect-server mapping), so the structural cast is safe.
  const rpc = new Proxy(commands, {
    get(target, prop: string | symbol, receiver) {
      const handler: unknown = Reflect.get(target, prop, receiver);
      if (typeof handler !== "function") {
        return handler;
      }
      const dispatch = handler as (req: unknown, connectionId: string) => unknown;
      return (req: unknown) => dispatch.call(target, req, connectionId);
    },
  }) as unknown as LodeCommandsClient;
  return { rpc, connectionId, close: () => {} };
}
