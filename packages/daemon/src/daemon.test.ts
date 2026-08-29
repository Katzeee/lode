import { createServer } from "node:net";

import { describe, expect, it, vi } from "vitest";

import type { EngineApi } from "@lode/sdk/host";
import { startDaemon } from "./daemon.js";
import { ConnectServerResource } from "./resources/connect-server-resource.js";

describe("Daemon", () => {
  it("reports Engine cleanup failure when listener startup rolls back", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", () => {
        blocker.off("error", reject);
        resolve();
      });
    });
    const address = blocker.address();
    if (!address || typeof address === "string") {
      throw new Error("TCP blocker has no port");
    }
    try {
      await expect(
        startDaemon({
          engine: {
            api: {} as EngineApi,
            stop: () => Promise.reject(new Error("injected Engine cleanup failure")),
          },
          listen: `tcp://127.0.0.1:${address.port}`,
          exchangeAddress: "tcp://127.0.0.1:1",
          accessToken: "token",
          status: { homeName: "test", daemonVersion: "test", homePath: "test" },
        }),
      ).rejects.toThrow("Daemon startup failed to roll back cleanly");
    } finally {
      await new Promise<void>((resolve, reject) => {
        blocker.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("caches an Engine shutdown failure without retrying it", async () => {
    let stopAttempts = 0;
    const daemon = await startDaemon({
      engine: {
        api: {} as EngineApi,
        stop: () => {
          stopAttempts += 1;
          return stopAttempts === 1 ? Promise.reject(new Error("injected Engine stop failure")) : Promise.resolve();
        },
      },
      listen: "tcp://127.0.0.1:0",
      exchangeAddress: "tcp://127.0.0.1:1",
      accessToken: "token",
      status: { homeName: "test", daemonVersion: "test", homePath: "test" },
    });

    await expect(daemon.stop()).rejects.toThrow("injected Engine stop failure");
    await expect(daemon.stop()).rejects.toThrow("injected Engine stop failure");
    expect(stopAttempts).toBe(1);
  });

  it("keeps the Engine active until the Client Session listener closes", async () => {
    const closeSpy = vi.spyOn(ConnectServerResource.prototype, "close");
    closeSpy.mockRejectedValueOnce(new Error("injected listener close failure"));
    let engineStopAttempts = 0;
    const daemon = await startDaemon({
      engine: {
        api: {} as EngineApi,
        stop: () => {
          engineStopAttempts += 1;
          return Promise.resolve();
        },
      },
      listen: "tcp://127.0.0.1:0",
      exchangeAddress: "tcp://127.0.0.1:1",
      accessToken: "token",
      status: { homeName: "test", daemonVersion: "test", homePath: "test" },
    });
    try {
      await expect(daemon.stop()).rejects.toThrow("injected listener close failure");
      expect(engineStopAttempts).toBe(0);
      await expect(daemon.stop()).rejects.toThrow("injected listener close failure");
      expect(engineStopAttempts).toBe(0);
    } finally {
      const control = closeSpy.mock.instances[0] as ConnectServerResource | undefined;
      closeSpy.mockRestore();
      await control?.close();
    }
  });
});
