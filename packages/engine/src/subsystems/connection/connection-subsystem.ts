import { defineEngineSubsystem } from "../definition.js";
import type { ReplicaConnectionCapability } from "./capability.js";
import type { PeerTransportPort, ReplicaExchangeHandler } from "./port.js";

export function createConnectionSubsystemDefinition(transport: PeerTransportPort) {
  return defineEngineSubsystem({
    id: "connection",
    dependencies: {},
    create: (_dependencies, control) => {
      let handler: ReplicaExchangeHandler | undefined;
      return {
        capability: {
          dial: (endpoint) => {
            assertRunning(control.stopRequested);
            return transport.dial(endpoint);
          },
          registerInbound: (registered) => {
            assertRunning(control.stopRequested);
            if (handler) {
              throw new Error("Replica Exchange inbound handler is already registered");
            }
            handler = registered;
            return () => {
              if (handler === registered) {
                handler = undefined;
              }
            };
          },
        } satisfies ReplicaConnectionCapability,
        init: () => transport.init?.(),
        start: () =>
          transport.start(
            forwardingHandler(
              () => handler,
              () => control.stopRequested,
            ),
          ),
        stop: async () => {
          handler = undefined;
          await transport.close();
        },
      };
    },
  });
}

function forwardingHandler(
  handler: () => ReplicaExchangeHandler | undefined,
  stopRequested: () => boolean,
): ReplicaExchangeHandler {
  const current = (): ReplicaExchangeHandler => {
    const registered = handler();
    if (stopRequested() || !registered) {
      throw new Error("Replica Exchange inbound delivery is unavailable");
    }
    return registered;
  };
  return {
    exchangeProfile: (proof) => current().exchangeProfile(proof),
    exchangeFetch: (proof, documentId, sealedFrom) => current().exchangeFetch(proof, documentId, sealedFrom),
    exchangeSend: (proof, documentId, sealedPayload) => current().exchangeSend(proof, documentId, sealedPayload),
  };
}

function assertRunning(stopRequested: boolean): void {
  if (stopRequested) {
    throw new Error("Connection subsystem is stopping");
  }
}
