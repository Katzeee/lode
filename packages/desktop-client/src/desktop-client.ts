import net, { type Socket } from "node:net";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import {
  AdoptWorkspaceRequestSchema,
  CreateWorkspaceRequestSchema,
  DaemonService,
  EngineCommandSchema,
  EngineEventSchema,
  EngineQuerySchema,
  EngineService,
  EngineWorkspaceService,
  QueryResultSchema,
  WriteResultSchema,
  WorkspaceSyncRequestSchema,
  IdentityService,
  WorkspaceGovernanceService,
} from "@lode/protocol/proto";
import {
  createTransportEngineApplication,
  parseEndpoint,
  type EngineApplicationContract,
  type EngineTransport,
  type Unsubscribe,
} from "@lode/sdk";
import type { EngineIdentity, WorkspaceSummary } from "@lode/sdk/host";
import { createGovernanceSurface, createIdentitySurface, type DesktopGovernanceSurface } from "./identity-surface.js";

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
      execute: async (bytes) => {
        const request = fromBinary(EngineCommandSchema, bytes);
        const response = await this.transport.application.execute(request, { headers: this.requestHeaders });
        return toBinary(WriteResultSchema, response);
      },
      query: async (bytes) => {
        const request = fromBinary(EngineQuerySchema, bytes);
        const response = await this.transport.application.query(request, { headers: this.requestHeaders });
        return toBinary(QueryResultSchema, response);
      },
      subscribe: (listener) => this.subscribeBytes(listener),
    };
  }

  private subscribeBytes(listener: (bytes: Uint8Array) => void): Unsubscribe {
    const iterator = this.transport.application
      .listenEvents({}, { signal: this.abortEvents.signal, headers: this.requestHeaders })
      [Symbol.asyncIterator]();
    let active = true;
    void (async () => {
      try {
        while (active) {
          const result = await iterator.next();
          if (result.done) {
            break;
          }
          listener(toBinary(EngineEventSchema, result.value));
        }
      } catch {
        active = false;
      }
    })();
    return () => {
      active = false;
      void iterator.return?.();
    };
  }

  close(): void {
    this.abortEvents.abort();
    this.transport.close();
  }
}

type SocketDial = Readonly<{ tcpUrl: string }> | Readonly<{ authority: string; createConnection: () => Socket }>;

function createSocketTransport(dial: SocketDial): ConnectTransport {
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
  const socketTransport = createSocketTransport(dialTarget(endpoint));
  const transport = new SocketEngineTransport(socketTransport, accessToken);
  const headers = () => new Headers({ authorization: `Bearer ${accessToken}` });
  const identitySurface = createIdentitySurface(socketTransport, headers);
  const governanceSurface = createGovernanceSurface(socketTransport, headers);
  return {
    execute: (command) => transport.application.execute(command),
    query: (query) => transport.application.query(query),
    subscribe: (listener) => transport.application.subscribe(listener),
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

function dialTarget(endpoint: string): SocketDial {
  const parsed = parseEndpoint(endpoint);
  switch (parsed.scheme) {
    case "tcp":
      return { tcpUrl: `http://${parsed.host}:${parsed.port}` };
    case "unix":
      return {
        authority: "http://lode.local",
        createConnection: () => net.connect(parsed.socketPath),
      };
    case "pipe":
      return {
        authority: "http://lode.local",
        createConnection: () => net.connect(`\\\\.\\pipe\\${parsed.pipeName}`),
      };
  }
}
