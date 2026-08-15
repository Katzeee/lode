import net, { type Socket } from "node:net";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import {
  DaemonService,
  EngineCommandSchema,
  EngineEventSchema,
  EngineQuerySchema,
  EngineService,
  EngineWorkspaceService,
  QueryResultSchema,
  WriteResultSchema,
  WorkspaceRequestSchema,
  WorkspaceSyncRequestSchema,
} from "@lode/protocol/proto";
import {
  createTransportEngineApplication,
  type EngineApplicationContract,
  type EngineTransport,
  type Unsubscribe,
} from "@lode/sdk";

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

  async openWorkspace(workspaceId: string): Promise<void> {
    await this.transport.workspaces.openWorkspace(create(WorkspaceRequestSchema, { workspaceId }), {
      headers: this.requestHeaders,
    });
  }

  async closeWorkspace(workspaceId: string): Promise<boolean> {
    return (
      await this.transport.workspaces.closeWorkspace(create(WorkspaceRequestSchema, { workspaceId }), {
        headers: this.requestHeaders,
      })
    ).closed;
  }

  async recoverWorkspaceAuthority(workspaceId: string): Promise<boolean> {
    return (
      await this.transport.workspaces.recoverWorkspaceAuthority(create(WorkspaceRequestSchema, { workspaceId }), {
        headers: this.requestHeaders,
      })
    ).recovered;
  }

  async syncWorkspace(workspaceId: string, remoteEndpoint: string): Promise<void> {
    await this.transport.daemon.syncWorkspace(create(WorkspaceSyncRequestSchema, { workspaceId, remoteEndpoint }), {
      headers: this.requestHeaders,
    });
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

export type DesktopClient = EngineApplicationContract &
  Readonly<{
    openWorkspace(workspaceId: string): Promise<void>;
    closeWorkspace(workspaceId: string): Promise<boolean>;
    recoverWorkspaceAuthority(workspaceId: string): Promise<boolean>;
    syncWorkspace(workspaceId: string, remoteEndpoint: string): Promise<void>;
    close(): void;
  }>;

export function createDesktopClient(endpoint: string, accessToken: string): DesktopClient {
  const transport = new SocketEngineTransport(createSocketTransport(dialTarget(endpoint)), accessToken);
  return {
    execute: (command) => transport.application.execute(command),
    query: (query) => transport.application.query(query),
    subscribe: (listener) => transport.application.subscribe(listener),
    openWorkspace: (workspaceId) => transport.openWorkspace(workspaceId),
    closeWorkspace: (workspaceId) => transport.closeWorkspace(workspaceId),
    recoverWorkspaceAuthority: (workspaceId) => transport.recoverWorkspaceAuthority(workspaceId),
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
