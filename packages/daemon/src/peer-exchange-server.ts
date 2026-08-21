import http2 from "node:http2";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  PeerExchangePayloadSchema,
  PeerExchangeProfileResponseSchema,
  PeerExchangeService,
  TransitHandshakeSchema,
  type PeerAuthentication,
  type PeerExchangeFetchRequest,
  type PeerExchangeProfileRequest,
  type PeerExchangeSendRequest,
} from "@lode/protocol/proto";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import type { ReplicaExchangeHandler, ReplicaExchangeProof } from "@lode/engine/host";

/**
 * The remote replica-exchange listener: one HTTP/2 server publishing only
 * PeerExchangeService. No Home access token guards it — the Engine verifies
 * each request's peer proof against the workspace's replayed governance
 * state, and every payload rides sealed under the workspace transit key.
 */

export function createPeerExchangeServer(exchange: ReplicaExchangeHandler): Readonly<{ server: http2.Http2Server }> {
  const handler = connectNodeAdapter({
    grpc: true,
    routes: (router) => {
      router.service(PeerExchangeService, {
        profile: async (request: PeerExchangeProfileRequest) => {
          const exchanged = await exchange.exchangeProfile(proofOf(request.auth));
          return create(PeerExchangeProfileResponseSchema, {
            handshake: create(TransitHandshakeSchema, {
              epoch: exchanged.handshake.epoch,
              envelopeEphemeral: exchanged.handshake.envelopeEphemeral,
              envelopeSeal: exchanged.handshake.envelopeSeal,
            }),
            sealedProfile: exchanged.sealedProfile,
          });
        },
        fetch: async (request: PeerExchangeFetchRequest) => {
          const sealed = await exchange.exchangeFetch(proofOf(request.auth), request.documentId, request.sealedFrom);
          return create(PeerExchangePayloadSchema, { sealedPayload: sealed });
        },
        send: async (request: PeerExchangeSendRequest) => {
          await exchange.exchangeSend(proofOf(request.auth), request.documentId, request.sealedPayload);
          return create(EmptySchema);
        },
      });
    },
  });
  return { server: http2.createServer({}, handler) };
}

function proofOf(auth: PeerAuthentication | undefined): ReplicaExchangeProof {
  if (!auth) {
    throw new ConnectError("Peer exchange requires peer authentication", Code.Unauthenticated);
  }
  return { workspaceId: auth.workspaceId, peerId: auth.peerId, nonce: auth.nonce, signature: auth.signature };
}
