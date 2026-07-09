import { describe, expect, it } from "vitest";
import {
  AppServerClient,
  createInProcessTransport,
  createSocketTransport,
} from "./app-server-client.js";

describe("AppServerClient over a socket transport", () => {
  it("exposes a typed LodeCommands rpc and closes without connecting", () => {
    const client = new AppServerClient(createSocketTransport("http://127.0.0.1:1"));
    expect(typeof client.rpc.createWorkspace).toBe("function");
    expect(typeof client.rpc.getNode).toBe("function");
    expect(typeof client.rpc.listenNotifications).toBe("function");
    client.close();
  });
});

describe("AppServerClient over an in-process transport", () => {
  // A stub commands bag: each handler records the connectionId it was called with so the test can
  // assert the transport threads ONE stable id through every call (the in-process analogue of the
  // HTTP/2 connectionId the daemon's connect-server assigns).
  function stubCommands() {
    const calls: { method: string; req: unknown; connectionId: string }[] = [];
    const commands = {
      sessionHello: (req: unknown, connectionId: string) => {
        calls.push({ method: "sessionHello", req, connectionId });
        return { sessionId: "s-1" };
      },
      createWorkspace: (req: unknown, connectionId: string) => {
        calls.push({ method: "createWorkspace", req, connectionId });
        return Promise.resolve({ workspaceId: (req as { workspaceId: string }).workspaceId });
      },
      listenNotifications: (req: unknown, connectionId: string) => {
        calls.push({ method: "listenNotifications", req, connectionId });
        return {
          [Symbol.asyncIterator]() {
            return { next: () => Promise.resolve({ value: undefined, done: true as const }) };
          },
        };
      },
    };
    return { commands, calls };
  }

  it("dispatches rpc methods straight to the commands handlers with one stable connectionId", async () => {
    const { commands, calls } = stubCommands();
    const transport = createInProcessTransport(commands);
    const client = new AppServerClient(transport);

    await client.authenticate({ actorMnemonic: "mnemonic" });
    const info = await client.rpc.createWorkspace({ workspaceId: "ws-1" });

    expect(info).toEqual({ workspaceId: "ws-1" });
    expect(calls.map((c) => c.method)).toEqual(["sessionHello", "createWorkspace"]);
    // Every call threaded the transport's single connectionId — no socket, no per-call id.
    expect(new Set(calls.map((c) => c.connectionId))).toEqual(new Set([transport.connectionId]));
    client.close();
  });

  it("honors an explicit connectionId so the host can match it to session lifecycle", async () => {
    const { commands, calls } = stubCommands();
    const transport = createInProcessTransport(commands, { connectionId: "host-owned-id" });
    const client = new AppServerClient(transport);

    await client.authenticate({ actorMnemonic: "mnemonic" });
    expect(transport.connectionId).toBe("host-owned-id");
    expect(calls.every((c) => c.connectionId === "host-owned-id")).toBe(true);
    client.close();
  });
});
