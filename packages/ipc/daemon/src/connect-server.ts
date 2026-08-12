import http2 from "node:http2";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createContextValues, type HandlerContext } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  EngineEnvelopeSchema,
  LodeCommands,
  WorkspaceSyncProfileEntrySchema,
  WorkspaceSyncProfileSchema,
  type EngineEnvelope,
  type OpenWorkspaceRequest,
  type WorkspaceSyncFetchRequest,
  type WorkspaceSyncProfileRequest,
  type WorkspaceSyncRequest,
  type WorkspaceSyncSendRequest,
} from "@lode/protocol/proto";
import type { Unsubscribe } from "@lode/engine";
import { createEngineTransportServer, type EngineRuntime } from "@lode/engine/server";
import { EmptySchema, type Empty } from "@bufbuild/protobuf/wkt";
import { createPeerSyncTransport } from "./peer-sync-transport.js";

export function createLodeServer(
  runtime: EngineRuntime,
  onShutdown?: () => void,
): Readonly<{ server: http2.Http2Server; closeConnections(): void }> {
  const transport = createEngineTransportServer(runtime.engine);
  const sessions = new Set<http2.Http2Session>();
  const handler = connectNodeAdapter({
    grpc: true,
    routes: (router) =>
      router.service(LodeCommands, {
        openWorkspace: unary(async (request: OpenWorkspaceRequest) => {
          await runtime.openWorkspace(request.workspaceId);
          return create(EmptySchema);
        }),
        recoverWorkspaceAuthority: unary(async (request: OpenWorkspaceRequest) => {
          if (!(await runtime.recoverWorkspaceAuthority(request.workspaceId))) {
            throw new Error(`Workspace is not loaded: ${request.workspaceId}`);
          }
          return create(EmptySchema);
        }),
        request: unary(async (request: EngineEnvelope) =>
          create(EngineEnvelopeSchema, { payload: await transport.request(request.payload) }),
        ),
        syncWorkspace: unary(async (request: WorkspaceSyncRequest) => {
          const peer = createPeerSyncTransport(request.remoteEndpoint, request.workspaceId);
          try {
            await runtime.syncWorkspace(request.workspaceId, peer.transport);
          } finally {
            peer.close();
          }
          return create(EmptySchema);
        }),
        syncProfile: unary(async (request: WorkspaceSyncProfileRequest) => {
          const entries = await runtime.workspaceSyncTransport(request.workspaceId).profile();
          return create(WorkspaceSyncProfileSchema, {
            entries: entries.map((entry) => create(WorkspaceSyncProfileEntrySchema, entry)),
          });
        }),
        syncFetch: unary(async (request: WorkspaceSyncFetchRequest) =>
          create(EngineEnvelopeSchema, {
            payload: await runtime
              .workspaceSyncTransport(request.workspaceId)
              .fetch(request.documentId, request.from),
          }),
        ),
        syncSend: unary(async (request: WorkspaceSyncSendRequest) => {
          await runtime
            .workspaceSyncTransport(request.workspaceId)
            .send(request.documentId, request.payload);
          return create(EmptySchema);
        }),
        listenEngineEvents: (_request: Empty, context: HandlerContext) =>
          eventStream(transport.subscribe ?? (() => () => {}), context.signal),
        shutdown: unary(() => {
          if (onShutdown) {
            setImmediate(onShutdown);
          }
          return create(EmptySchema);
        }),
      }),
    contextValues: (request) => {
      const session = (request as http2.Http2ServerRequest).stream.session;
      if (session) {
        sessions.add(session);
        session.once("close", () => sessions.delete(session));
      }
      return createContextValues();
    },
  });
  return {
    server: http2.createServer({}, handler),
    closeConnections: () => {
      for (const session of sessions) {
        session.destroy();
      }
    },
  };
}

export function toConnectError(error: unknown): ConnectError {
  return error instanceof ConnectError
    ? error
    : new ConnectError(error instanceof Error ? error.message : String(error), Code.Internal);
}

function unary<I, O>(handler: (request: I) => Promise<O> | O) {
  return async (request: I): Promise<O> => {
    try {
      return await handler(request);
    } catch (error) {
      throw toConnectError(error);
    }
  };
}

function eventStream(
  subscribe: (listener: (bytes: Uint8Array) => void) => Unsubscribe,
  signal: AbortSignal,
): AsyncIterable<EngineEnvelope> {
  const queue = new EventQueue();
  const unsubscribe = subscribe((bytes) => queue.push(bytes));
  signal.addEventListener("abort", () => {
    unsubscribe();
    queue.close();
  });
  return queue;
}

class EventQueue implements AsyncIterable<EngineEnvelope> {
  private readonly values: EngineEnvelope[] = [];
  private readonly waiters: ((result: IteratorResult<EngineEnvelope>) => void)[] = [];
  private closed = false;

  push(bytes: Uint8Array): void {
    const value = create(EngineEnvelopeSchema, {
      payload: bytes,
    });
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
    } else if (this.values.length < 256) {
      this.values.push(value);
    }
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<EngineEnvelope> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) {
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
