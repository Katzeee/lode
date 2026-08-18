import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import {
  ReplicaSyncService,
  WorkspaceSyncFetchRequestSchema,
  WorkspaceSyncProfileRequestSchema,
  WorkspaceSyncSendRequestSchema,
} from "@lode/protocol/proto";
import type { ReplicaPeer } from "@lode/sdk/host";

import { dialTarget } from "./endpoint.js";

export function createPeerSyncTransport(
  endpoint: string,
  workspaceId: string,
  accessToken: string,
): Readonly<{ peer: ReplicaPeer; close(): void }> {
  const dial = dialTarget(endpoint);
  const manager =
    "tcpUrl" in dial
      ? new Http2SessionManager(dial.tcpUrl)
      : new Http2SessionManager(dial.authority, undefined, {
          createConnection: dial.createConnection,
        });
  const transport = createGrpcTransport({
    baseUrl: "tcpUrl" in dial ? dial.tcpUrl : dial.authority,
    sessionManager: manager,
  });
  const rpc = createClient(ReplicaSyncService, transport);
  const headers = new Headers({ authorization: `Bearer ${accessToken}` });
  return {
    peer: {
      profile: async () =>
        (
          await rpc.profile(create(WorkspaceSyncProfileRequestSchema, { workspaceId }), {
            headers,
          })
        ).entries.map((entry) => ({
          documentId: entry.documentId,
          version: entry.version,
        })),
      fetch: async (documentId, from) =>
        (await rpc.fetch(create(WorkspaceSyncFetchRequestSchema, { workspaceId, documentId, from }), { headers }))
          .payload,
      send: async (documentId, payload) => {
        await rpc.send(create(WorkspaceSyncSendRequestSchema, { workspaceId, documentId, payload }), { headers });
      },
    },
    close: () => manager.abort(),
  };
}
