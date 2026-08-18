import { timingSafeEqual } from "node:crypto";
import http2 from "node:http2";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { Code, ConnectError, createContextValues, type HandlerContext } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { EmptySchema, type Empty } from "@bufbuild/protobuf/wkt";
import {
  AdoptWorkspaceResultSchema,
  DaemonService,
  DaemonStatusSchema,
  EngineCommandSchema,
  EngineEventSchema,
  EngineQuerySchema,
  EngineService,
  EngineWorkspaceService,
  IdentityService,
  ListWorkspacesResultSchema,
  QueryResultSchema,
  RecoverWorkspaceAuthorityResultSchema,
  WorkspaceGovernanceService,
  WorkspaceRunState,
  WorkspaceSummarySchema,
  WorkspaceSyncResultSchema,
  WriteResultSchema,
  type AdoptWorkspaceRequest,
  type CreateWorkspaceRequest,
  type EngineCommand,
  type EngineEvent as ProtocolEngineEvent,
  type EngineQuery,
  type WorkspaceRequest,
  type WorkspaceSyncRequest,
} from "@lode/protocol/proto";
import {
  GovernanceAuthorizationError,
  GovernancePreconditionError,
  WorkspaceNotFoundError,
  type Engine,
} from "@lode/sdk/host";
import { governanceRoutes, identityRoutes, type UnaryWrapper } from "./control-identity.js";
import {
  decodeEngineCommand,
  decodeEngineQuery,
  encodeEngineEvent,
  encodeEngineQueryResult,
  encodeWriteResult,
  type EngineEvent,
  type Unsubscribe,
} from "@lode/sdk";

/** Home identity the daemon reports through `DaemonService.Status`. */
export type DaemonStatusIdentity = Readonly<{
  homeName: string;
  daemonVersion: string;
  homePath: string;
}>;

/**
 * The local control plane: daemon management, Engine commands and events,
 * workspace lifecycle (create, adopt, recover), Actor identity, and signed
 * governance — all behind the Home access token. Remote replica exchange
 * lives on its own listener (peer-exchange-server) with its own
 * workspace-scoped authorization.
 */
export function createLodeServer(
  engine: Engine,
  accessToken: string,
  status: DaemonStatusIdentity,
  onShutdown?: () => void,
): Readonly<{ server: http2.Http2Server; closeConnections(): void }> {
  if (accessToken.length === 0) {
    throw new Error("Desktop daemon access token must not be empty");
  }
  const sessions = new Set<http2.Http2Session>();
  const handler = connectNodeAdapter({
    grpc: true,
    routes: (router) => {
      router.service(DaemonService, {
        syncWorkspace: unary(accessToken, async (request: WorkspaceSyncRequest) => {
          const peer = await engine.replicas.remotePeer(request.remoteEndpoint, request.workspaceId);
          return create(WorkspaceSyncResultSchema, await engine.replicas.synchronize(request.workspaceId, peer));
        }),
        status: unary(accessToken, async () =>
          create(DaemonStatusSchema, {
            homeName: status.homeName,
            daemonVersion: status.daemonVersion,
            homePath: status.homePath,
            // Serving implies every cataloged session already reached active or
            // a diagnosable authority-fault: engine creation awaits startAll.
            ready: true,
            workspaces: (await engine.workspaces.listWorkspaces()).map(toProtocolSummary),
          }),
        ),
        shutdown: unary(accessToken, () => {
          if (onShutdown) {
            setImmediate(onShutdown);
          }
          return create(EmptySchema);
        }),
      });
      router.service(IdentityService, identityRoutes(engine, unaryAdapter(accessToken)));
      router.service(WorkspaceGovernanceService, governanceRoutes(engine, unaryAdapter(accessToken)));
      router.service(EngineWorkspaceService, {
        recoverWorkspaceAuthority: unary(accessToken, async (request: WorkspaceRequest) =>
          create(RecoverWorkspaceAuthorityResultSchema, {
            recovered: await engine.workspaces.recoverAuthority(request.workspaceId),
          }),
        ),
        listWorkspaces: unary(accessToken, async () =>
          create(ListWorkspacesResultSchema, {
            workspaces: (await engine.workspaces.listWorkspaces()).map(toProtocolSummary),
          }),
        ),
        createWorkspace: unary(accessToken, async (request: CreateWorkspaceRequest) => {
          await engine.workspaces.createWorkspace({
            workspaceId: request.workspaceId,
            label: request.name,
            ownerActorId: request.actorId,
          });
          return create(EmptySchema);
        }),
        adoptWorkspace: unary(accessToken, async (request: AdoptWorkspaceRequest) => {
          const adopted = await engine.workspaces.adoptWorkspace({
            endpoint: request.endpoint,
            workspaceId: request.workspaceId,
          });
          return create(AdoptWorkspaceResultSchema, adopted);
        }),
      });
      router.service(EngineService, {
        execute: unary(accessToken, async (request: EngineCommand) => {
          const command = decodeEngineCommand(toBinary(EngineCommandSchema, request));
          return fromBinary(WriteResultSchema, encodeWriteResult(await engine.application.execute(command)));
        }),
        query: unary(accessToken, async (request: EngineQuery) => {
          const query = decodeEngineQuery(toBinary(EngineQuerySchema, request));
          return fromBinary(QueryResultSchema, encodeEngineQueryResult(query, await engine.application.query(query)));
        }),
        listenEvents: (_request: Empty, context: HandlerContext) => {
          authenticate(context, accessToken);
          return eventStream(engine.application.subscribe, context.signal);
        },
      });
    },
    contextValues: (request) => {
      const session = (request as http2.Http2ServerRequest).stream.session;
      if (session && !sessions.has(session)) {
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

function toProtocolSummary(summary: { workspaceId: string; label: string; state: "active" | "authority-fault" }) {
  return create(WorkspaceSummarySchema, {
    workspaceId: summary.workspaceId,
    label: summary.label,
    state: summary.state === "authority-fault" ? WorkspaceRunState.AUTHORITY_FAULT : WorkspaceRunState.ACTIVE,
  });
}

function toConnectError(error: unknown): ConnectError {
  if (error instanceof ConnectError) {
    return error;
  }
  if (error instanceof WorkspaceNotFoundError) {
    return new ConnectError(error.message, Code.NotFound);
  }
  if (error instanceof GovernanceAuthorizationError) {
    return new ConnectError(error.message, Code.PermissionDenied);
  }
  if (error instanceof GovernancePreconditionError) {
    return new ConnectError(error.message, Code.FailedPrecondition);
  }
  return new ConnectError(error instanceof Error ? error.message : String(error), Code.Internal);
}

function unaryAdapter(accessToken: string): UnaryWrapper {
  return (handler) => unary(accessToken, handler);
}

function unary<I, O>(accessToken: string, handler: (request: I) => Promise<O> | O) {
  return async (request: I, context: HandlerContext): Promise<O> => {
    try {
      authenticate(context, accessToken);
      return await handler(request);
    } catch (error) {
      throw toConnectError(error);
    }
  };
}

function authenticate(context: HandlerContext, accessToken: string): void {
  const authorization = context.requestHeader.get("authorization");
  const expected = Buffer.from(`Bearer ${accessToken}`);
  const actual = Buffer.from(authorization ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ConnectError("Desktop daemon authentication failed", Code.Unauthenticated);
  }
}

function eventStream(
  subscribe: (listener: (event: EngineEvent) => void) => Unsubscribe,
  signal: AbortSignal,
): AsyncIterable<ProtocolEngineEvent> {
  const queue = new EventQueue();
  const unsubscribe = subscribe((event) => queue.push(event));
  signal.addEventListener("abort", () => {
    unsubscribe();
    queue.close();
  });
  return queue;
}

class EventQueue implements AsyncIterable<ProtocolEngineEvent> {
  private readonly values: ProtocolEngineEvent[] = [];
  private readonly waiters: ((result: IteratorResult<ProtocolEngineEvent>) => void)[] = [];
  private closed = false;

  push(event: EngineEvent): void {
    const value = fromBinary(EngineEventSchema, encodeEngineEvent(event));
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

  [Symbol.asyncIterator](): AsyncIterator<ProtocolEngineEvent> {
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
