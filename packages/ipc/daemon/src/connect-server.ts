import http2 from "node:http2";
import { randomUUID } from "node:crypto";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  Code,
  ConnectError,
  createContextKey,
  createContextValues,
  type HandlerContext,
} from "@connectrpc/connect";
import { LodeCommands } from "@lode/protocol/proto";
import {
  DomainInvalidInputError,
  DocNotFoundError,
  NotFoundError,
  SessionRequiredError,
  AuthenticationError,
  PreconditionFailedError,
  NotOwnerError,
  type EngineRuntime,
} from "@lode/engine";

// Per-call connection id, stamped into the handler context by the adapter (one id per
// HTTP/2 session). Identifies a client for session/subscription/notification routing.
const connectionIdKey = createContextKey<string | undefined>(undefined);

function getConnectionId(context: HandlerContext): string {
  const id = context.values.get(connectionIdKey);
  if (id === undefined) {
    throw new ConnectError("connectionId missing on context", Code.Internal);
  }
  return id;
}

// Maps engine-thrown typed errors to Connect status. The engine stays free of wire/error
// knowledge; the daemon owns this mapping. In-process callers handle typed errors directly.
export function toConnectError(error: unknown): ConnectError {
  if (error instanceof ConnectError) {
    return error;
  }
  if (error instanceof SessionRequiredError) {
    return new ConnectError(error.message, Code.Unauthenticated);
  }
  if (error instanceof AuthenticationError) {
    return new ConnectError(error.message, Code.Unauthenticated);
  }
  if (error instanceof NotOwnerError) {
    return new ConnectError(error.message, Code.PermissionDenied);
  }
  if (error instanceof DocNotFoundError) {
    return new ConnectError(error.message, Code.NotFound);
  }
  if (error instanceof NotFoundError) {
    return new ConnectError(error.message, Code.NotFound);
  }
  if (error instanceof DomainInvalidInputError) {
    return new ConnectError(error.message, Code.InvalidArgument);
  }
  if (error instanceof PreconditionFailedError) {
    return new ConnectError(error.message, Code.FailedPrecondition);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ConnectError(message, Code.Internal);
}

function unary<I, O>(handler: (req: I, connectionId: string) => Promise<O> | O) {
  return async (req: I, context: HandlerContext): Promise<O> => {
    try {
      return await handler(req, getConnectionId(context));
    } catch (error) {
      throw toConnectError(error);
    }
  };
}

function serverStreaming<I, O>(handler: (req: I, connectionId: string) => AsyncIterable<O>) {
  return (req: I, context: HandlerContext): AsyncIterable<O> => {
    const inner = handler(req, getConnectionId(context))[Symbol.asyncIterator]();
    return {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            try {
              return await inner.next();
            } catch (error) {
              throw toConnectError(error);
            }
          },
        };
      },
    };
  };
}

// Creates an HTTP/2 (h2c, plaintext) server speaking gRPC, hosting the engine's LodeCommands
// handlers. One connectionId is assigned per HTTP/2 session and cleaned up on session close.
// Returns the server plus closeConnections() to forcibly tear down live sessions on shutdown
// (http2 servers don't expose closeAllConnections like http servers do).
export function createLodeServer(runtime: EngineRuntime): {
  server: http2.Http2Server;
  closeConnections: () => void;
} {
  // The engine's full auth-wrapped command bag — every LodeCommands RPC (incl. the sync
  // share/join/register/syncNow, now engine-resident). The daemon is pure transport: it routes the
  // bag, owns no handlers, and reaches no engine subsystem directly.
  const commands = runtime.commands;
  const sessions = new Map<http2.Http2Session, string>();

  const handler = connectNodeAdapter({
    grpc: true,
    // req is contextually typed as NodeServerRequest (http.IncomingMessage | http2.Http2ServerRequest);
    // we serve http2 only.
    contextValues: (req) => {
      const session = (req as http2.Http2ServerRequest).stream.session;
      if (session === undefined) {
        throw new ConnectError("connection has no HTTP/2 session", Code.Internal);
      }
      let id = sessions.get(session);
      if (id === undefined) {
        id = randomUUID();
        sessions.set(session, id);
        session.on("close", () => {
          sessions.delete(session);
          // A closed connection drops its session record + its notification stream/subscriber
          // entries — the engine's single connection-teardown hook converges both halves.
          void runtime.onConnectionClosed(id as string);
        });
      }
      return createContextValues().set(connectionIdKey, id);
    },
    routes: (router) => {
      // Route every command in the bag: unary except listenNotifications (server-streaming). Iterating
      // the bag — not a hand-listed table — keeps routes in lockstep with the command set: add a
      // command and it is routed. Each wrapped command is `(req, connectionId) => result`, so the bag
      // is a uniform record of callables.
      const bag = commands as unknown as Record<
        string,
        (req: unknown, connectionId: string) => unknown
      >;
      const impl: Record<string, unknown> = {};
      for (const [name, handler] of Object.entries(bag)) {
        impl[name] =
          name === "listenNotifications"
            ? serverStreaming(
                handler as (req: unknown, connectionId: string) => AsyncIterable<unknown>,
              )
            : unary(handler);
      }
      return router.service(LodeCommands, impl);
    },
  });

  return {
    server: http2.createServer({}, handler),
    closeConnections: () => {
      for (const session of sessions.keys()) {
        session.destroy();
      }
    },
  };
}
