import { afterEach, describe, expect, it } from "vitest";
import { BrokerClient } from "@lode/engine";
import type { AppServerDaemon, RelayDaemon } from "../../src/app-server-daemon.js";
import { startAppServerDaemon, startRelayDaemon } from "../../src/app-server-daemon.js";

// `--relay` hosts the workspace-routing broker in-process. Smoke: the hosted relay is dialable and
// tears down cleanly. (Secured sync convergence is covered by sync-secured-e2e.) Relay-only mode
// (no --listen) is the separate `startRelayDaemon` entry — no engine/gRPC.

const handles: (AppServerDaemon | RelayDaemon)[] = [];

afterEach(async () => {
  for (const h of handles.splice(0)) {
    await h.stop();
  }
});

describe("daemon relay host (--relay)", () => {
  it("hosts a relay in-process via the relay option (combined with the engine)", async () => {
    const daemon = await startAppServerDaemon({
      listen: "tcp://127.0.0.1:0",
      relay: { port: 0 },
    });
    handles.push(daemon);

    expect(daemon.relayUrl).toMatch(/^https?:\/\/127\.0\.0\.1:\d+$/);

    // A broker client can dial the hosted relay (open resolves once the socket is connected).
    const probe = new BrokerClient({ url: daemon.relayUrl!, onDeliver: () => {} });
    await probe.open();
    probe.close();

    // Must tear down cleanly (relay + Connect server + runtime).
    await expect(daemon.stop()).resolves.toBeUndefined();
    handles.pop();
  });

  it("runs relay-only via startRelayDaemon (no engine, no gRPC)", async () => {
    const relay = await startRelayDaemon({ relay: { port: 0 } });
    handles.push(relay);

    expect(relay.relayUrl).toMatch(/^https?:\/\/127\.0\.0\.1:\d+$/);

    const probe = new BrokerClient({ url: relay.relayUrl, onDeliver: () => {} });
    await probe.open();
    probe.close();

    await expect(relay.stop()).resolves.toBeUndefined();
    handles.pop();
  });
});
