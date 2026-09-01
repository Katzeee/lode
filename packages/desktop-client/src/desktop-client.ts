import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { dialNodeEndpoint, type NodeEndpointDial } from "@lode/node-endpoint";
import {
  AdoptWorkspaceRequestSchema,
  CreateWorkspaceRequestSchema,
  DaemonService,
  EngineService,
  EngineWorkspaceService,
  WorkspaceSyncRequestSchema,
  IdentityService,
  WorkspaceGovernanceService,
  type EngineEvent as ProtocolEngineEvent,
} from "@lode/protocol/proto";
import {
  createTransportEngineApplication,
  type EngineApplicationContract,
  type EngineTransport,
  type EventFailureListener,
  type Unsubscribe,
} from "@lode/sdk";
import type { EngineIdentity, WorkspaceSummary } from "@lode/sdk/host";
import { createGovernanceSurface, createIdentitySurface, type DesktopGovernanceSurface } from "./identity-surface.js";
import { consumeEventStream } from "./event-stream.js";

type ConnectTransport = Readonly<{
  daemon: Client<typeof DaemonService>;
  application: Client<typeof EngineService>;
  workspaces: Client<typeof EngineWorkspaceService>;
  identity: Client<typeof IdentityService>;
  governance: Client<typeof WorkspaceGovernanceService>;
  close(): void;
}>;

class SocketEngineTransport {
  readonly application: EngineApplicationContract;
  private readonly abortEvents = new AbortController();
  private readonly requestHeaders: Headers;

  constructor(
    private readonly transport: ConnectTransport,
    accessToken: string,
  ) {
    if (accessToken.length === 0) {
      throw new Error("Desktop daemon access token must not be empty");
    }
    this.requestHeaders = new Headers({ authorization: `Bearer ${accessToken}` });
    this.application = createTransportEngineApplication(this.engineTransport());
  }

  async listWorkspaces(): Promise<readonly WorkspaceSummary[]> {
    const result = await this.transport.workspaces.listWorkspaces(create(EmptySchema), {
      headers: this.requestHeaders,
    });
    return result.workspaces.map((summary) => ({
      workspaceId: summary.workspaceId,
      label: summary.label,
    }));
  }

  async createWorkspace(workspaceId: string, name: string, actorId: string): Promise<void> {
    await this.transport.workspaces.createWorkspace(
      create(CreateWorkspaceRequestSchema, { workspaceId, name, actorId }),
      { headers: this.requestHeaders },
    );
  }

  async adoptWorkspace(
    endpoint: string,
    workspaceId: string,
  ): Promise<Readonly<{ workspaceId: string; label: string }>> {
    const adopted = await this.transport.workspaces.adoptWorkspace(
      create(AdoptWorkspaceRequestSchema, { endpoint, workspaceId }),
      { headers: this.requestHeaders },
    );
    return { workspaceId: adopted.workspaceId, label: adopted.label };
  }

  async status(): Promise<DaemonStatusView> {
    const status = await this.transport.daemon.status(create(EmptySchema), { headers: this.requestHeaders });
    return {
      homeName: status.homeName,
      daemonVersion: status.daemonVersion,
      homePath: status.homePath,
      ready: status.ready,
      workspaces: status.workspaces.map((summary) => ({
        workspaceId: summary.workspaceId,
        label: summary.label,
      })),
    };
  }

  async shutdown(): Promise<void> {
    await this.transport.daemon.shutdown(create(EmptySchema), { headers: this.requestHeaders });
  }

  async syncWorkspace(
    workspaceId: string,
    remoteEndpoint: string,
  ): Promise<Readonly<{ pulled: number; pushed: number }>> {
    const result = await this.transport.daemon.syncWorkspace(
      create(WorkspaceSyncRequestSchema, { workspaceId, remoteEndpoint }),
      { headers: this.requestHeaders },
    );
    return { pulled: result.pulled, pushed: result.pushed };
  }

  private engineTransport(): EngineTransport {
    return {
      execute: async (command) => {
        try {
          const response = await this.transport.application.execute(command, { headers: this.requestHeaders });
          return { status: "response", message: response };
        } catch (error) {
          if (commandExecutionOutcomeIsUnknown(error)) {
            return { status: "outcome-unknown" };
          }
          throw error;
        }
      },
      query: async (query) => this.transport.application.query(query, { headers: this.requestHeaders }),
      subscribe: (listener, onError) => this.subscribeEvents(listener, onError),
    };
  }

  private subscribeEvents(listener: (event: ProtocolEngineEvent) => void, onError: EventFailureListener): Unsubscribe {
    const iterator = this.transport.application
      .listenEvents({}, { signal: this.abortEvents.signal, headers: this.requestHeaders })
      [Symbol.asyncIterator]();
    return consumeEventStream(iterator, listener, onError, this.abortEvents.signal);
  }

  close(): void {
    this.abortEvents.abort();
    this.transport.close();
  }
}

export function commandExecutionOutcomeIsUnknown(error: unknown): boolean {
  if (!(error instanceof ConnectError)) {
    return false;
  }
  switch (error.code) {
    case Code.Canceled:
    case Code.DeadlineExceeded:
    case Code.Unavailable:
      return true;
    case Code.Unknown:
    case Code.InvalidArgument:
    case Code.NotFound:
    case Code.AlreadyExists:
    case Code.PermissionDenied:
    case Code.ResourceExhausted:
    case Code.FailedPrecondition:
    case Code.Aborted:
    case Code.OutOfRange:
    case Code.Unimplemented:
    case Code.Internal:
    case Code.DataLoss:
    case Code.Unauthenticated:
      return false;
  }
}

function createSocketTransport(dial: NodeEndpointDial): ConnectTransport {
  const sessionManager =
    "tcpUrl" in dial
      ? new Http2SessionManager(dial.tcpUrl)
      : new Http2SessionManager(dial.authority, undefined, {
          createConnection: dial.createConnection,
        });
  const transport = createGrpcTransport({
    baseUrl: "tcpUrl" in dial ? dial.tcpUrl : dial.authority,
    sessionManager,
  });
  return {
    daemon: createClient(DaemonService, transport),
    application: createClient(EngineService, transport),
    workspaces: createClient(EngineWorkspaceService, transport),
    identity: createClient(IdentityService, transport),
    governance: createClient(WorkspaceGovernanceService, transport),
    close: () => sessionManager.abort(),
  };
}

export type DaemonStatusView = Readonly<{
  homeName: string;
  daemonVersion: string;
  homePath: string;
  ready: boolean;
  workspaces: readonly WorkspaceSummary[];
}>;

export type DesktopClient = EngineApplicationContract &
  EngineIdentity &
  DesktopGovernanceSurface &
  Readonly<{
    status(): Promise<DaemonStatusView>;
    shutdown(): Promise<void>;
    listWorkspaces(): Promise<readonly WorkspaceSummary[]>;
    createWorkspace(workspaceId: string, name: string, actorId: string): Promise<void>;
    adoptWorkspace(endpoint: string, workspaceId: string): Promise<Readonly<{ workspaceId: string; label: string }>>;
    syncWorkspace(workspaceId: string, remoteEndpoint: string): Promise<Readonly<{ pulled: number; pushed: number }>>;
    close(): void;
  }>;

export function createDesktopClient(endpoint: string, accessToken: string): DesktopClient {
  const socketTransport = createSocketTransport(dialNodeEndpoint(endpoint));
  const transport = new SocketEngineTransport(socketTransport, accessToken);
  const headers = () => new Headers({ authorization: `Bearer ${accessToken}` });
  const identitySurface = createIdentitySurface(socketTransport, headers);
  const governanceSurface = createGovernanceSurface(socketTransport, headers);
  return {
    execute: (command) => transport.application.execute(command),
    query: (query) => transport.application.query(query),
    subscribe: (listener, onError) => transport.application.subscribe(listener, onError),
    status: () => transport.status(),
    shutdown: () => transport.shutdown(),
    listWorkspaces: () => transport.listWorkspaces(),
    createWorkspace: (workspaceId, name, actorId) => transport.createWorkspace(workspaceId, name, actorId),
    adoptWorkspace: (endpoint, workspaceId) => transport.adoptWorkspace(endpoint, workspaceId),
    ...identitySurface,
    ...governanceSurface,
    syncWorkspace: (workspaceId, remoteEndpoint) => transport.syncWorkspace(workspaceId, remoteEndpoint),
    close: () => transport.close(),
  };
}
