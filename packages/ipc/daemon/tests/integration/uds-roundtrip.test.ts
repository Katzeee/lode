import { afterEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServerClient, createSocketTransport } from "@lode/client";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/index.js";
import { openAuthedSession } from "./authed-session.js";

// The Phase-1 endpoint verification: a real daemon on a Unix domain socket + a client over that
// socket (Http2SessionManager with createConnection → net.connect). TCP stays covered by every other
// integration test; this nails the UDS path that auto-spawn relies on.
describe("Unix domain socket endpoint", () => {
  let daemon: AppServerDaemon | null = null;

  afterEach(async () => {
    await daemon?.stop();
    daemon = null;
  });

  it("serves RPCs over a unix:// socket", async () => {
    const socketPath = join(tmpdir(), `lode-uds-${Math.random().toString(36).slice(2)}.sock`);
    daemon = await startAppServerDaemon({ listen: `unix://${socketPath}` });
    expect(daemon.address).toBe(`unix://${socketPath}`);

    const client = new AppServerClient(createSocketTransport(daemon.address));
    client.connect();
    await openAuthedSession(client);
    await expect(client.rpc.listWorkspaces({})).resolves.toMatchObject({ workspaces: [] });
    client.close();
  });

  it("chmods the socket 0600", async () => {
    const { statSync } = await import("node:fs");
    const socketPath = join(tmpdir(), `lode-uds-${Math.random().toString(36).slice(2)}.sock`);
    daemon = await startAppServerDaemon({ listen: `unix://${socketPath}` });
    // Group/other read+execute bits clear; owner read+write set.
    expect(statSync(socketPath).mode & 0o077).toBe(0o000);
  });
});
