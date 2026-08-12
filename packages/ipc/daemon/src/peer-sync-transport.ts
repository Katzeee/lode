import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import {
  LodeCommands,
  WorkspaceSyncFetchRequestSchema,
  WorkspaceSyncProfileRequestSchema,
  WorkspaceSyncSendRequestSchema,
} from "@lode/protocol/proto";
import type { SyncTransport } from "@lode/engine/server";

import { dialTarget } from "./endpoint.js";

export function createPeerSyncTransport(
  endpoint: string,
  workspaceId: string,
): Readonly<{ transport: SyncTransport; close(): void }> {
  const dial = dialTarget(endpoint);
  const manager =
    "tcpUrl" in dial
      ? new Http2SessionManager(dial.tcpUrl)
      : new Http2SessionManager(dial.authority, undefined, {
          createConnection: dial.createConnection,
        });
  const rpc = createClient(
    LodeCommands,
    createGrpcTransport({
      baseUrl: "tcpUrl" in dial ? dial.tcpUrl : dial.authority,
      sessionManager: manager,
    }),
  );
  return {
    transport: {
      profile: async () =>
        (
          await rpc.syncProfile(create(WorkspaceSyncProfileRequestSchema, { workspaceId }))
        ).entries.map((entry) => ({
          documentId: entry.documentId,
          version: entry.version,
        })),
      fetch: async (documentId, from) =>
        (
          await rpc.syncFetch(
            create(WorkspaceSyncFetchRequestSchema, { workspaceId, documentId, from }),
          )
        ).payload,
      send: async (documentId, payload) => {
        await rpc.syncSend(
          create(WorkspaceSyncSendRequestSchema, { workspaceId, documentId, payload }),
        );
      },
    },
    close: () => manager.abort(),
  };
}
