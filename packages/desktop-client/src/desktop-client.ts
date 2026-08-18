import net, { type Socket } from "node:net";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import {
  CreateWorkspaceRequestSchema,
  DaemonService,
  EngineCommandSchema,
  EngineEventSchema,
  EngineQuerySchema,
  EngineService,
  EngineWorkspaceService,
  QueryResultSchema,
  WriteResultSchema,
  WorkspaceRequestSchema,
  WorkspaceRunState as ProtocolWorkspaceRunState,
  WorkspaceSyncRequestSchema,
} from "@lode/protocol/proto";
import {
  createTransportEngineApplication,
  type EngineApplicationContract,
  type EngineTransport,
  type Unsubscribe,
} from "@lode/sdk";
import type { WorkspaceRunState } from "@lode/sdk/host";

type ConnectTransport = Readonly<{
  daemon: Client<typeof DaemonService>;
  application: Client<typeof EngineService>;
  workspaces: Client<typeof EngineWorkspaceService>;
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

  async recoverWorkspaceAuthority(workspaceId: string): Promise<boolean> {
    return (
      await this.transport.workspaces.recoverWorkspaceAuthority(create(WorkspaceRequestSchema, { workspaceId }), {
        headers: this.requestHeaders,
      })
    ).recovered;
  }

  async listWorkspaces(): Promise<readonly { workspaceId: string; label: string; state: WorkspaceRunState }[]> {
    const result = await this.transport.workspaces.listWorkspaces(create(EmptySchema), {
      headers: this.requestHeaders,
    });
    return result.workspaces.map((summary) => ({
      workspaceId: summary.workspaceId,
      label: summary.label,
      state: summary.state === ProtocolWorkspaceRunState.AUTHORITY_FAULT ? "authority-fault" : "active",
    }));
  }

  async createWorkspace(workspaceId: string, name: string): Promise<void> {
    await this.transport.workspaces.createWorkspace(create(CreateWorkspaceRequestSchema, { workspaceId, name }), {
      headers: this.requestHeaders,
    });
  }

  async shutdown(): Promise<void> {
    await this.transport.daemon.shutdown(create(EmptySchema), { headers: this.requestHeaders });
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
        state: summary.state === ProtocolWorkspaceRunState.AUTHORITY_FAULT ? "authority-fault" : "active",
      })),
    };
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

export type SocketDial = Readonly<{ tcpUrl: string }> | Readonly<{ authority: string; createConnection: () => Socket }>;

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
    close: () => sessionManager.abort(),
  };
}

export type DaemonStatusView = Readonly<{
  homeName: string;
  daemonVersion: string;
  homePath: string;
  ready: boolean;
  workspaces: readonly Readonly<{ workspaceId: string; label: string; state: WorkspaceRunState }>[];
}>;

export type DesktopClient = EngineApplicationContract &
  Readonly<{
    status(): Promise<DaemonStatusView>;
    shutdown(): Promise<void>;
    recoverWorkspaceAuthority(workspaceId: string): Promise<boolean>;
    listWorkspaces(): Promise<readonly { workspaceId: string; label: string; state: WorkspaceRunState }[]>;
    createWorkspace(workspaceId: string, name: string): Promise<void>;
    syncWorkspace(workspaceId: string, remoteEndpoint: string): Promise<Readonly<{ pulled: number; pushed: number }>>;
    close(): void;
  }>;

export function createDesktopClient(endpoint: string, accessToken: string): DesktopClient {
  const transport = new SocketEngineTransport(createSocketTransport(dialTarget(endpoint)), accessToken);
  return {
    execute: (command) => transport.application.execute(command),
    query: (query) => transport.application.query(query),
    subscribe: (listener) => transport.application.subscribe(listener),
    status: () => transport.status(),
    shutdown: () => transport.shutdown(),
    recoverWorkspaceAuthority: (workspaceId) => transport.recoverWorkspaceAuthority(workspaceId),
    listWorkspaces: () => transport.listWorkspaces(),
    createWorkspace: (workspaceId, name) => transport.createWorkspace(workspaceId, name),
    syncWorkspace: (workspaceId, remoteEndpoint) => transport.syncWorkspace(workspaceId, remoteEndpoint),
    close: () => transport.close(),
  };
}

function dialTarget(endpoint: string): SocketDial {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`Invalid desktop daemon endpoint: ${endpoint}`);
  }
  switch (url.protocol) {
    case "tcp:":
    case "http:": {
      const host = url.hostname || "127.0.0.1";
      const port = url.port === "" ? 0 : Number.parseInt(url.port, 10);
      return { tcpUrl: `http://${host}:${port}` };
    }
    case "unix:":
      if (url.pathname === "") {
        throw new Error(`unix:// endpoint requires a path: ${endpoint}`);
      }
      return {
        authority: "http://lode.local",
        createConnection: () => net.connect(url.pathname),
      };
    case "pipe:":
      if (url.host === "") {
        throw new Error(`pipe:// endpoint requires a pipe name: ${endpoint}`);
      }
      return {
        authority: "http://lode.local",
        createConnection: () => net.connect(`\\\\.\\pipe\\${url.host}`),
      };
    default:
      throw new Error(`Unsupported desktop daemon endpoint: ${endpoint}`);
  }
}
