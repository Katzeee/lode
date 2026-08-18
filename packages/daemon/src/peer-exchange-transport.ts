import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import {
  PeerAuthenticationSchema,
  PeerExchangeFetchRequestSchema,
  PeerExchangeProfileRequestSchema,
  PeerExchangeSendRequestSchema,
  PeerExchangeService,
} from "@lode/protocol/proto";
import type { PeerExchangeProof, PeerExchangeWire } from "@lode/sdk/host";

import { dialTarget } from "./endpoint.js";

/**
 * The dialing half of the remote exchange boundary: turns an opaque endpoint
 * address into a PeerExchangeWire for the Engine. No Home access token and no
 * authentication headers — the Engine signs each request's peer proof and
 * seals each payload; this module only moves bytes.
 */

export function dialPeerExchange(endpoint: string): Readonly<{ wire: PeerExchangeWire; close(): void }> {
  const dial = dialTarget(endpoint);
  const manager =
    "tcpUrl" in dial
      ? new Http2SessionManager(dial.tcpUrl)
      : new Http2SessionManager(dial.authority, undefined, { createConnection: dial.createConnection });
  const transport = createGrpcTransport({
    baseUrl: "tcpUrl" in dial ? dial.tcpUrl : dial.authority,
    sessionManager: manager,
  });
  const rpc = createClient(PeerExchangeService, transport);
  return {
    wire: {
      profile: async (proof) => {
        const response = await rpc.profile(create(PeerExchangeProfileRequestSchema, { auth: encodeProof(proof) }));
        const handshake = response.handshake;
        if (!handshake) {
          throw new Error("Remote exchange omitted its transit handshake");
        }
        return {
          handshake: {
            epoch: handshake.epoch,
            envelopeEphemeral: handshake.envelopeEphemeral,
            envelopeSeal: handshake.envelopeSeal,
          },
          sealedProfile: response.sealedProfile,
        };
      },
      fetch: async (proof, documentId, sealedFrom) => {
        const response = await rpc.fetch(
          create(PeerExchangeFetchRequestSchema, {
            auth: encodeProof(proof),
            documentId,
            sealedFrom,
          }),
        );
        return response.sealedPayload;
      },
      send: async (proof, documentId, sealedPayload) => {
        await rpc.send(
          create(PeerExchangeSendRequestSchema, {
            auth: encodeProof(proof),
            documentId,
            sealedPayload,
          }),
        );
      },
    },
    close: () => manager.abort(),
  };
}

function encodeProof(proof: PeerExchangeProof) {
  return create(PeerAuthenticationSchema, {
    workspaceId: proof.workspaceId,
    peerId: proof.peerId,
    nonce: proof.nonce,
    signature: proof.signature,
  });
}

/** Daemon-owned connection pool; repeated syncs reuse sessions and shutdown releases them. */
export class PeerExchangeDialPool {
  private readonly dials = new Map<string, ReturnType<typeof dialPeerExchange>>();

  wire = (endpoint: string): PeerExchangeWire => {
    const existing = this.dials.get(endpoint);
    if (existing) {
      return existing.wire;
    }
    const dialed = dialPeerExchange(endpoint);
    this.dials.set(endpoint, dialed);
    return dialed.wire;
  };

  close(): void {
    for (const dial of this.dials.values()) {
      dial.close();
    }
    this.dials.clear();
  }
}
