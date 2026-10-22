import { chmod } from "node:fs/promises";
import { constants, type ServerHttp2Session } from "node:http2";

import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { dialNodeEndpoint } from "@lode/node-endpoint";
import {
  PeerAuthenticationSchema,
  PeerExchangeFetchRequestSchema,
  PeerExchangeProfileRequestSchema,
  PeerExchangeSendRequestSchema,
  PeerExchangeService,
} from "@lode/protocol/proto";
import type {
  PeerTransportPort,
  ReplicaExchangeHandler,
  ReplicaExchangeProof,
  ReplicaExchangeWire,
} from "@lode/engine";
import { parseEndpoint, type ParsedEndpoint } from "@lode/sdk";

import { canonicalAddress, listenTarget } from "./endpoint.js";
import { createPeerExchangeServer } from "./peer-exchange-server.js";

/**
 * The dialing half of the remote exchange boundary: turns an opaque endpoint
 * address into a PeerExchangeWire for the Engine. No Home access token and no
 * authentication headers — the Engine signs each request's peer proof and
 * seals each payload; this module only moves bytes.
 */

function dialPeerExchange(endpoint: string): Readonly<{ wire: ReplicaExchangeWire; close(): void }> {
  const dial = dialNodeEndpoint(endpoint);
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

function encodeProof(proof: ReplicaExchangeProof) {
  return create(PeerAuthenticationSchema, {
    workspaceId: proof.workspaceId,
    peerId: proof.peerId,
    nonce: proof.nonce,
    signature: proof.signature,
  });
}

/** Desktop transport channel pool; repeated exchanges reuse channels until Connection stops the accepted adapter. */
class PeerConnectionPool {
  private readonly dials = new Map<string, ReturnType<typeof dialPeerExchange>>();

  wire = (endpoint: string): ReplicaExchangeWire => {
    const existing = this.dials.get(endpoint);
    if (existing) {
      return existing.wire;
    }
    const dialed = dialPeerExchange(endpoint);
    this.dials.set(endpoint, dialed);
    return dialed.wire;
  };

  close(): void {
    const failures: Error[] = [];
    for (const dial of this.dials.values()) {
      try {
        dial.close();
      } catch (error) {
        failures.push(toError(error));
      }
    }
    this.dials.clear();
    throwCleanupFailures(failures, "Peer connections failed to close cleanly");
  }
}

export class DesktopPeerTransport implements PeerTransportPort {
  private readonly endpoint: ParsedEndpoint;
  private readonly connections = new PeerConnectionPool();
  private readonly inboundSessions = new Set<ServerHttp2Session>();
  private server?: ReturnType<typeof createPeerExchangeServer>["server"];
  private boundPort = 0;

  constructor(endpoint: string) {
    this.endpoint = parseEndpoint(endpoint);
  }

  get address(): string {
    return canonicalAddress(this.endpoint, this.boundPort);
  }

  async start(handler: ReplicaExchangeHandler): Promise<void> {
    if (this.server) {
      throw new Error("Desktop Peer Transport is already started");
    }
    const { server } = createPeerExchangeServer(handler);
    this.server = server;
    server.on("session", (session) => {
      this.inboundSessions.add(session);
      session.on("error", () => {
        // Forced owner shutdown reports through close(); the session error is not an independent failure channel.
      });
      session.once("close", () => this.inboundSessions.delete(session));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(listenTarget(this.endpoint), () => {
          server.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      if (this.server === server) {
        this.server = undefined;
      }
      throw error;
    }
    if (this.endpoint.scheme === "tcp") {
      this.boundPort = (server.address() as { port: number }).port;
    } else if (this.endpoint.scheme === "unix") {
      try {
        await chmod(this.endpoint.socketPath, 0o600);
      } catch (error) {
        try {
          await this.close();
        } catch (cleanupError) {
          const failure = new AggregateError(
            [toError(error), toError(cleanupError)],
            "Peer listener setup and cleanup failed",
            { cause: error },
          );
          throw failure;
        }
        throw error;
      }
    }
  }

  dial(endpoint: string): ReplicaExchangeWire {
    return this.connections.wire(endpoint);
  }

  async close(): Promise<void> {
    const failures: Error[] = [];
    try {
      this.connections.close();
    } catch (error) {
      failures.push(toError(error));
    }
    for (const session of this.inboundSessions) {
      try {
        session.destroy(new Error("Desktop Peer Transport is stopping"), constants.NGHTTP2_CANCEL);
      } catch (error) {
        failures.push(toError(error));
      }
    }
    this.inboundSessions.clear();
    if (this.server) {
      const server = this.server;
      this.server = undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      } catch (error) {
        failures.push(toError(error));
      }
    }
    throwCleanupFailures(failures, "Desktop Peer Transport failed to close cleanly");
  }
}

function throwCleanupFailures(failures: readonly Error[], message: string): void {
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, message);
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
