export type ReplicaExchangeProof = Readonly<{
  workspaceId: string;
  peerId: string;
  nonce: string;
  signature: Uint8Array;
}>;

export type TransitHandshake = Readonly<{
  epoch: number;
  envelopeEphemeral: Uint8Array;
  envelopeSeal: Uint8Array;
}>;

export type ReplicaExchangeWire = Readonly<{
  profile(proof: ReplicaExchangeProof): Promise<Readonly<{ handshake: TransitHandshake; sealedProfile: Uint8Array }>>;
  fetch(proof: ReplicaExchangeProof, documentId: string, sealedFrom: Uint8Array): Promise<Uint8Array>;
  send(proof: ReplicaExchangeProof, documentId: string, sealedPayload: Uint8Array): Promise<void>;
}>;

export type ReplicaExchangeHandler = Readonly<{
  exchangeProfile(
    proof: ReplicaExchangeProof,
  ): Promise<Readonly<{ handshake: TransitHandshake; sealedProfile: Uint8Array }>>;
  exchangeFetch(proof: ReplicaExchangeProof, documentId: string, sealedFrom: Uint8Array): Promise<Uint8Array>;
  exchangeSend(proof: ReplicaExchangeProof, documentId: string, sealedPayload: Uint8Array): Promise<void>;
}>;

export type PeerTransportPort = Readonly<{
  init?(): void | Promise<void>;
  start(handler: ReplicaExchangeHandler): void | Promise<void>;
  dial(endpoint: string): ReplicaExchangeWire;
  close(): void | Promise<void>;
}>;
