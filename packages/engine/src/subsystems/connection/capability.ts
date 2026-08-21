import type { ReplicaExchangeHandler, ReplicaExchangeWire } from "./port.js";

export type ReplicaConnectionCapability = Readonly<{
  dial(endpoint: string): ReplicaExchangeWire;
  registerInbound(handler: ReplicaExchangeHandler): () => void;
}>;
