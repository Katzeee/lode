import { describe, expect, it } from "vitest";

import type { ReplicaExchangeHandler } from "@lode/engine";

import { DesktopPeerTransport } from "./peer-exchange-transport.js";

describe("DesktopPeerTransport", () => {
  it("reuses one physical channel wire for repeated dials to an endpoint", async () => {
    const transport = new DesktopPeerTransport("tcp://127.0.0.1:0");
    const first = transport.dial("tcp://127.0.0.1:1");
    const second = transport.dial("tcp://127.0.0.1:1");

    expect(second).toBe(first);
    await transport.close();
  });

  it("closes an active inbound session without waiting for its request handler", async () => {
    let markReceived!: () => void;
    const received = new Promise<void>((resolve) => {
      markReceived = resolve;
    });
    const handler: ReplicaExchangeHandler = {
      exchangeProfile: async () => {
        markReceived();
        return new Promise(() => {});
      },
      exchangeFetch: () => Promise.reject(new Error("unexpected fetch")),
      exchangeSend: () => Promise.reject(new Error("unexpected send")),
    };
    const serverTransport = new DesktopPeerTransport("tcp://127.0.0.1:0");
    const clientTransport = new DesktopPeerTransport("tcp://127.0.0.1:0");
    await serverTransport.start(handler);
    const request = clientTransport.dial(serverTransport.address).profile({
      workspaceId: "workspace",
      peerId: "peer",
      nonce: "nonce",
      signature: new Uint8Array(),
    });
    await received;
    const rejectedRequest = expect(request).rejects.toBeDefined();

    await expect(serverTransport.close()).resolves.toBeUndefined();
    await rejectedRequest;
    await clientTransport.close();
  });

  it("closes an idle inbound channel without leaking a client session error", async () => {
    const handler: ReplicaExchangeHandler = {
      exchangeProfile: () =>
        Promise.resolve({
          handshake: {
            epoch: 1,
            envelopeEphemeral: new Uint8Array(),
            envelopeSeal: new Uint8Array(),
          },
          sealedProfile: new Uint8Array(),
        }),
      exchangeFetch: () => Promise.reject(new Error("unexpected fetch")),
      exchangeSend: () => Promise.reject(new Error("unexpected send")),
    };
    const serverTransport = new DesktopPeerTransport("tcp://127.0.0.1:0");
    const clientTransport = new DesktopPeerTransport("tcp://127.0.0.1:0");
    await serverTransport.start(handler);
    await clientTransport.dial(serverTransport.address).profile({
      workspaceId: "workspace",
      peerId: "peer",
      nonce: "nonce",
      signature: new Uint8Array(),
    });

    await serverTransport.close();
    await clientTransport.close();
  });
});
