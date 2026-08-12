import type { Socket } from "node:net";

import { create } from "@bufbuild/protobuf";
import { createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import {
  EngineEnvelopeSchema,
  LodeCommands,
  OpenWorkspaceRequestSchema,
  WorkspaceSyncRequestSchema,
} from "@lode/protocol/proto";
import {
  createTransportEngineContract,
  type EngineContract,
  type EngineTransport,
  type Unsubscribe,
} from "@lode/engine";

type LodeCommandsClient = Client<typeof LodeCommands>;

type AppServerTransport = Readonly<{
  rpc: LodeCommandsClient;
  close(): void;
}>;

class SocketEngineTransport implements EngineTransport {
  readonly engine: EngineContract;
  private readonly abortEvents = new AbortController();
  private readonly requestHeaders: Headers;

  constructor(
    private readonly transport: AppServerTransport,
    accessToken: string,
  ) {
    if (accessToken.length === 0) {
      throw new Error("App server access token must not be empty");
    }
    this.requestHeaders = new Headers({ authorization: `Bearer ${accessToken}` });
    this.engine = createTransportEngineContract(this);
  }

  async openWorkspace(workspaceId: string): Promise<void> {
    await this.transport.rpc.openWorkspace(create(OpenWorkspaceRequestSchema, { workspaceId }), {
      headers: this.requestHeaders,
    });
  }

  async recoverWorkspaceAuthority(workspaceId: string): Promise<void> {
    await this.transport.rpc.recoverWorkspaceAuthority(
      create(OpenWorkspaceRequestSchema, { workspaceId }),
      { headers: this.requestHeaders },
    );
  }

  async syncWorkspace(workspaceId: string, remoteEndpoint: string): Promise<void> {
    await this.transport.rpc.syncWorkspace(
      create(WorkspaceSyncRequestSchema, { workspaceId, remoteEndpoint }),
      { headers: this.requestHeaders },
    );
  }

  async request(bytes: Uint8Array): Promise<Uint8Array> {
    const response = await this.transport.rpc.request(
      create(EngineEnvelopeSchema, { payload: bytes }),
      { headers: this.requestHeaders },
    );
    return response.payload;
  }

  subscribe(listener: (bytes: Uint8Array) => void): Unsubscribe {
    const iterator = this.transport.rpc
      .listenEngineEvents({}, { signal: this.abortEvents.signal, headers: this.requestHeaders })
      [Symbol.asyncIterator]();
    let active = true;
    void (async () => {
      try {
        while (active) {
          const result = await iterator.next();
          if (result.done) {
            break;
          }
          listener(result.value.payload);
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

export type SocketDial =
  Readonly<{ tcpUrl: string }> | Readonly<{ authority: string; createConnection: () => Socket }>;

function createSocketTransport(dial: SocketDial): AppServerTransport {
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
    rpc: createClient(LodeCommands, transport),
    close: () => sessionManager.abort(),
  };
}

export type AppServerClient = Readonly<{
  engine: EngineContract;
  openWorkspace(workspaceId: string): Promise<void>;
  recoverWorkspaceAuthority(workspaceId: string): Promise<void>;
  syncWorkspace(workspaceId: string, remoteEndpoint: string): Promise<void>;
  close(): void;
}>;

export function createAppServerClient(dial: SocketDial, accessToken: string): AppServerClient {
  const transport = new SocketEngineTransport(createSocketTransport(dial), accessToken);
  return {
    engine: transport.engine,
    openWorkspace: (workspaceId) => transport.openWorkspace(workspaceId),
    recoverWorkspaceAuthority: (workspaceId) => transport.recoverWorkspaceAuthority(workspaceId),
    syncWorkspace: (workspaceId, remoteEndpoint) =>
      transport.syncWorkspace(workspaceId, remoteEndpoint),
    close: () => transport.close(),
  };
}

export type InProcessEngineHost = Readonly<{
  engine: EngineContract;
  openWorkspace(workspaceId: string): Promise<void>;
}>;

export function createInProcessClient(runtime: InProcessEngineHost): Readonly<{
  engine: EngineContract;
  openWorkspace(workspaceId: string): Promise<void>;
  close(): void;
}> {
  return {
    engine: runtime.engine,
    openWorkspace: (workspaceId) => runtime.openWorkspace(workspaceId),
    close: () => {},
  };
}
