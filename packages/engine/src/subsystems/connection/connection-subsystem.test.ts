import { describe, expect, it, vi } from "vitest";

import { buildEngineSubsystems } from "../index.js";
import { createConnectionSubsystemDefinition } from "./connection-subsystem.js";
import type { PeerTransportPort, ReplicaExchangeHandler, ReplicaExchangeProof } from "./port.js";

describe("ConnectionSubsystem", () => {
  it("owns transport activation, inbound registration, dialing, and close", async () => {
    let inbound: ReplicaExchangeHandler | undefined;
    const wire = {
      profile: vi.fn(),
      fetch: vi.fn(),
      send: vi.fn(),
    };
    const transport: PeerTransportPort = {
      init: vi.fn(),
      start: (handler) => {
        inbound = handler;
      },
      dial: vi.fn(() => wire),
      close: vi.fn(),
    };
    const definition = createConnectionSubsystemDefinition(transport);
    const built = buildEngineSubsystems([definition] as const, ({ connection }) => connection);
    const handler: ReplicaExchangeHandler = {
      exchangeProfile: vi.fn(() =>
        Promise.resolve({
          handshake: { epoch: 1, envelopeEphemeral: new Uint8Array(), envelopeSeal: new Uint8Array() },
          sealedProfile: new Uint8Array([1]),
        }),
      ),
      exchangeFetch: vi.fn(() => Promise.resolve(new Uint8Array([2]))),
      exchangeSend: vi.fn(() => Promise.resolve()),
    };
    const unregister = built.api.registerInbound(handler);

    await built.lifecycle.start();
    expect(transport.init).toHaveBeenCalledOnce();
    expect(built.api.dial("peer://one")).toBe(wire);
    await expect(inbound?.exchangeFetch(proof, "facts", new Uint8Array())).resolves.toEqual(new Uint8Array([2]));

    unregister();
    expect(() => inbound?.exchangeFetch(proof, "facts", new Uint8Array())).toThrow("unavailable");
    await built.lifecycle.stop();
    expect(transport.close).toHaveBeenCalledOnce();
    expect(() => built.api.registerInbound(handler)).toThrow("Connection subsystem is stopping");
    expect(() => built.api.dial("peer://late")).toThrow("Connection subsystem is stopping");
    expect(transport.dial).toHaveBeenCalledOnce();
  });
});

const proof: ReplicaExchangeProof = {
  workspaceId: "workspace",
  peerId: `peer_${"0".repeat(64)}`,
  nonce: "nonce",
  signature: new Uint8Array(),
};
