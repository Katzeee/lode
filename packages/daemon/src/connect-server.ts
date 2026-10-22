import { timingSafeEqual } from "node:crypto";
import http2 from "node:http2";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createContextValues, type HandlerContext } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { EmptySchema, type Empty } from "@bufbuild/protobuf/wkt";
import {
  AdoptWorkspaceResultSchema,
  DaemonService,
  DaemonStatusSchema,
  EngineService,
  EngineWorkspaceService,
  IdentityService,
  ListWorkspacesResultSchema,
  WorkspaceGovernanceService,
  WorkspaceSummarySchema,
  WorkspaceSyncResultSchema,
  type AdoptWorkspaceRequest,
  type CreateWorkspaceRequest,
  type EngineCommand,
  type EngineQuery,
  type WorkspaceSyncRequest,
} from "@lode/protocol/proto";
import {
  GovernanceAuthorizationError,
  GovernancePreconditionError,
  WorkspaceNotFoundError,
  engineCommandFromMessage,
  engineQueryFromMessage,
  queryResultToMessage,
  writeResultToMessage,
  type EngineApi,
} from "@lode/sdk/host";
import { governanceRoutes, identityRoutes, type UnaryWrapper } from "./control-identity.js";
import { eventStream } from "./event-stream.js";

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
/**
 * How long a Client Session may take to drain its in-flight streams at
 * shutdown before it is cut. The grace lets short responses — most notably the
 * Shutdown RPC's own acknowledgement — reach the client instead of racing the
 * transport teardown; long-lived streams (event subscriptions) never drain on
 * their own and rely on the forced cut.
 */
const SESSION_DRAIN_GRACE_MS = 500;

export function createLodeServer(
  engine: EngineApi,
  accessToken: string,
  status: DaemonStatusIdentity,
  onShutdown: () => void,
): Readonly<{ server: http2.Http2Server; closeConnections(): Promise<void> }> {
  if (accessToken.length === 0) {
    throw new Error("Desktop daemon access token must not be empty");
  }
  const sessions = new Set<http2.Http2Session>();
  const handler = connectNodeAdapter({
    grpc: true,
    routes: (router) => {
      router.service(DaemonService, {
        syncWorkspace: unary(accessToken, async (request: WorkspaceSyncRequest) => {
          return create(
            WorkspaceSyncResultSchema,
            await engine.replicas.synchronize(request.workspaceId, request.remoteEndpoint),
          );
        }),
        status: unary(accessToken, async () =>
          create(DaemonStatusSchema, {
            homeName: status.homeName,
            daemonVersion: status.daemonVersion,
            homePath: status.homePath,
            // The listener is published only after Engine startup completes.
            ready: true,
            workspaces: (await engine.workspaces.listWorkspaces()).map(toProtocolSummary),
          }),
        ),
        shutdown: unary(accessToken, () => {
          setImmediate(onShutdown);
          return create(EmptySchema);
        }),
      });
      router.service(IdentityService, identityRoutes(engine, unaryAdapter(accessToken)));
      router.service(WorkspaceGovernanceService, governanceRoutes(engine, unaryAdapter(accessToken)));
      router.service(EngineWorkspaceService, {
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
          const command = engineCommandFromMessage(request);
          return writeResultToMessage(await engine.application.execute(command));
        }),
        query: unary(accessToken, async (request: EngineQuery) => {
          const query = engineQueryFromMessage(request);
          return queryResultToMessage(query, await engine.application.query(query));
        }),
        listenEvents: (_request: Empty, context: HandlerContext) => {
          authenticate(context, accessToken);
          return eventStream(engine.application.subscribe, context.signal);
        },
      });
    },
    contextValues: () => createContextValues(),
  });
  const server = http2.createServer({}, handler);
  server.on("session", (session) => {
    sessions.add(session);
    session.on("error", () => {
      // Forced Client Session shutdown is reported by the owning server resource.
    });
    session.once("close", () => sessions.delete(session));
  });
  return {
    server,
    closeConnections: async () => {
      await Promise.all([...sessions].map((session) => drainSession(session)));
    },
  };
}

function drainSession(session: http2.Http2Session): Promise<void> {
  return new Promise((resolve) => {
    if (session.destroyed) {
      resolve();
      return;
    }
    const cut = setTimeout(
      () => session.destroy(new Error("Daemon Client Session is stopping"), http2.constants.NGHTTP2_CANCEL),
      SESSION_DRAIN_GRACE_MS,
    );
    session.once("close", () => {
      clearTimeout(cut);
      resolve();
    });
    session.close();
  });
}

function toProtocolSummary(summary: { workspaceId: string; label: string }) {
  return create(WorkspaceSummarySchema, {
    workspaceId: summary.workspaceId,
    label: summary.label,
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
