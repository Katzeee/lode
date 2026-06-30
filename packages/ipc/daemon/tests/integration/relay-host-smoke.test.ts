import { afterEach, describe, expect, it } from "vitest";
import { BrokerClient } from "@lode/sync";
import type { AppServerDaemon } from "../../src/app-server-daemon.js";
import { startAppServerDaemon } from "../../src/app-server-daemon.js";
import { tempListenUrl } from "@lode/test-utils";

// `--relay` hosts the workspace-routing broker in-process. Smoke: the hosted relay is dialable and
// tears down cleanly with the daemon. (Secured sync convergence is covered by sync-secured-e2e.)

const daemons: AppServerDaemon[] = [];

afterEach(async () => {
  for (const d of daemons.splice(0)) {
    await d.stop();
  }
});

describe("daemon relay host (--relay)", () => {
  it("hosts a relay in-process via the relay option", async () => {
    const daemon = await startAppServerDaemon({
      listen: tempListenUrl(),
      relay: { port: 0 },
    });
    daemons.push(daemon);

    expect(daemon.relayUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);

    // A broker client can dial the hosted relay (open resolves once the socket is connected).
    const probe = new BrokerClient({ url: daemon.relayUrl!, onDeliver: () => {} });
    await probe.open();
    probe.close();

    // Must tear down cleanly (relay + Connect server + runtime).
    await expect(daemon.stop()).resolves.toBeUndefined();
    daemons.pop();
  });
});
