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
  SessionRequiredError,
  type AppRuntime,
} from "@lode/engine";
import type { SyncHandlers } from "./sync-handlers.js";

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
  if (error instanceof DocNotFoundError) {
    return new ConnectError(error.message, Code.NotFound);
  }
  if (error instanceof DomainInvalidInputError) {
    return new ConnectError(error.message, Code.InvalidArgument);
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
export function createLodeServer(
  runtime: AppRuntime,
  extraHandlers: SyncHandlers,
): {
  server: http2.Http2Server;
  closeConnections: () => void;
} {
  // Merge the engine's handlers with the daemon-side sync handlers (governance/share/join). The
  // engine is transport/host-free; the daemon is the composition root that owns the sync runner.
  const commands = { ...runtime.commands, ...extraHandlers };
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
          runtime.removeConnection(id as string);
        });
      }
      return createContextValues().set(connectionIdKey, id);
    },
    routes: (router) =>
      router.service(LodeCommands, {
        sessionHello: unary(commands.sessionHello),
        generateActorMnemonic: unary(commands.generateActorMnemonic),
        subscribeDoc: unary(commands.subscribeDoc),
        unsubscribeDoc: unary(commands.unsubscribeDoc),
        listenNotifications: serverStreaming(commands.listenNotifications),

        createWorkspace: unary(commands.createWorkspace),
        listWorkspaces: unary(commands.listWorkspaces),
        removeWorkspace: unary(commands.removeWorkspace),

        createPlainNode: unary(commands.createPlainNode),
        getNode: unary(commands.getNode),
        getNodeById: unary(commands.getNodeById),
        getNodeChildren: unary(commands.getNodeChildren),
        moveNode: unary(commands.moveNode),
        removeNodeOccurrence: unary(commands.removeNodeOccurrence),
        hardDeleteNode: unary(commands.hardDeleteNode),
        promoteCanonicalNode: unary(commands.promoteCanonicalNode),
        replaceNodeText: unary(commands.replaceNodeText),
        setNodeProp: unary(commands.setNodeProp),
        unsetNodeProp: unary(commands.unsetNodeProp),
        setOccurrenceProp: unary(commands.setOccurrenceProp),
        unsetOccurrenceProp: unary(commands.unsetOccurrenceProp),

        pasteNodes: unary(commands.pasteNodes),
        duplicateNode: unary(commands.duplicateNode),
        indentNodes: unary(commands.indentNodes),
        outdentNode: unary(commands.outdentNode),
        moveSiblingNode: unary(commands.moveSiblingNode),

        createRef: unary(commands.createRef),
        cloneRef: unary(commands.cloneRef),

        createSchema: unary(commands.createSchema),
        applySchema: unary(commands.applySchema),
        removeSchema: unary(commands.removeSchema),
        reconcileSchema: unary(commands.reconcileSchema),

        createFieldDef: unary(commands.createFieldDef),
        setFieldDefType: unary(commands.setFieldDefType),
        setFieldDefPresence: unary(commands.setFieldDefPresence),

        addField: unary(commands.addField),
        setFieldValues: unary(commands.setFieldValues),
        removeField: unary(commands.removeField),

        undoHistory: unary(commands.undoHistory),
        redoHistory: unary(commands.redoHistory),
        canUndoHistory: unary(commands.canUndoHistory),
        canRedoHistory: unary(commands.canRedoHistory),

        addMember: unary(commands.addMember),
        getActorPublicKeys: unary(commands.getActorPublicKeys),
        shareWorkspace: unary(commands.shareWorkspace),
        joinWorkspace: unary(commands.joinWorkspace),
        registerSync: unary(commands.registerSync),
        syncNow: unary(commands.syncNow),
      }),
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
