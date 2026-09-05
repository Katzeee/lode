import type { DaemonStatusView, DesktopClient, HomeSelection } from "@lode/desktop-client";
import { describe, expect, it, vi } from "vitest";

import { DaemonAuthority, type OwnedDaemon, type OwnedDaemonExit } from "./authority.js";

const selection: HomeSelection = { name: "test", path: "C:\\isolated-home" };
const status: DaemonStatusView = {
  daemonVersion: "test",
  homeName: "test",
  homePath: selection.path,
  ready: true,
  workspaces: [],
};

describe("desktop daemon authority", () => {
  it("reuses an authenticated daemon without spawning another authority", async () => {
    const client = clientFixture();
    const spawn = vi.fn<() => Promise<OwnedDaemon>>();
    const ensure = vi.fn();
    const authority = new DaemonAuthority({
      endpointExists: () => Promise.resolve(true),
      ensure,
      probe: () => Promise.resolve({ client, status }),
      spawn,
    });

    await expect(authority.connect(selection)).resolves.toMatchObject({ ownership: "reused", ownedPid: null });
    expect(spawn).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
    await expect(authority.close()).resolves.toEqual({ ownedPid: null, ownedExited: true, exitCode: null });
    expect(client.close).toHaveBeenCalledOnce();
    expect(client.shutdown).not.toHaveBeenCalled();
  });

  it("starts a missing daemon and leaves it available when the GUI disconnects", async () => {
    const process = ownedDaemonFixture(8123);
    const client = clientFixture(() => {
      process.resolveExit({ code: 0, output: "" });
      return Promise.resolve();
    });
    const spawn = vi.fn(() => Promise.resolve(process.owned));
    const authority = new DaemonAuthority({
      endpointExists: () => Promise.resolve(false),
      ensure: async (home, launcher) => {
        await launcher(home);
        return client;
      },
      probe: () => Promise.resolve(null),
      spawn,
    });

    await expect(authority.connect(selection)).resolves.toMatchObject({ ownership: "owned", ownedPid: 8123 });
    await expect(authority.close()).resolves.toEqual({ ownedPid: 8123, ownedExited: false, exitCode: null });
    expect(spawn).toHaveBeenCalledWith(selection);
    expect(client.shutdown).not.toHaveBeenCalled();
    expect(process.terminate).not.toHaveBeenCalled();
  });

  it("reports and replaces a stale endpoint", async () => {
    const process = ownedDaemonFixture(8124);
    const client = clientFixture(() => {
      process.resolveExit({ code: 0, output: "" });
      return Promise.resolve();
    });
    const authority = new DaemonAuthority({
      endpointExists: () => Promise.resolve(true),
      ensure: async (home, launcher) => {
        await launcher(home);
        return client;
      },
      probe: () => Promise.resolve(null),
      spawn: () => Promise.resolve(process.owned),
    });

    await expect(authority.connect(selection)).resolves.toMatchObject({
      notice: "A stale daemon endpoint was replaced by a live authority.",
      ownership: "owned",
    });
    await authority.close();
  });

  it("surfaces startup failure and terminates the process it acquired", async () => {
    const process = ownedDaemonFixture(8125);
    const authority = new DaemonAuthority({
      endpointExists: () => Promise.resolve(false),
      ensure: async (home, launcher) => {
        await launcher(home);
        return new Promise<DesktopClient>(() => undefined);
      },
      probe: () => Promise.resolve(null),
      spawn: () => {
        process.resolveExit({ code: 2, output: "lock publication failed" });
        return Promise.resolve(process.owned);
      },
    });

    await expect(authority.connect(selection)).rejects.toThrow(
      "Desktop daemon exited before it became ready (code 2): lock publication failed",
    );
    expect(process.terminate).toHaveBeenCalledOnce();
  });
});

function clientFixture(shutdown: () => Promise<void> = () => Promise.resolve()): DesktopClient {
  return {
    close: vi.fn(),
    shutdown: vi.fn(shutdown),
  } as unknown as DesktopClient;
}

function ownedDaemonFixture(pid: number): Readonly<{
  owned: OwnedDaemon;
  resolveExit(result: OwnedDaemonExit): void;
  terminate: ReturnType<typeof vi.fn<() => Promise<OwnedDaemonExit>>>;
}> {
  let resolveExit: (result: OwnedDaemonExit) => void = () => undefined;
  const exit = new Promise<OwnedDaemonExit>((resolve) => {
    resolveExit = resolve;
  });
  const terminate = vi.fn(() => exit);
  return { owned: { pid, exit, terminate }, resolveExit, terminate };
}
