import { afterEach, describe, expect, it } from "vitest";
import { AppServerClient, createSocketTransport } from "@lode/client";
import { dialTarget } from "../../src/endpoint.js";
import { startAppServerDaemon, type AppServerDaemon } from "../../src/app-server-daemon.js";
import { openAuthedSession } from "./authed-session.js";

describe("app server daemon runtime", () => {
  let daemon: AppServerDaemon | null = null;

  afterEach(async () => {
    await daemon?.stop();
    daemon = null;
  });

  it("starts from a tcp listen URL and accepts client RPCs", async () => {
    daemon = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0" });

    const client = new AppServerClient(createSocketTransport(dialTarget(daemon.address)));
    client.connect();
    await openAuthedSession(client);
    await expect(client.rpc.listWorkspaces({})).resolves.toMatchObject({ workspaces: [] });
    client.close();
  });

  it("stops gracefully and closes transport connections", async () => {
    daemon = await startAppServerDaemon({ listen: "tcp://127.0.0.1:0" });
    const client = new AppServerClient(createSocketTransport(dialTarget(daemon.address)));
    client.connect();

    await daemon.stop();
    daemon = null;

    await expect(client.rpc.listWorkspaces({})).rejects.toThrow();
    client.close();
  });
});
