import { describe, expect, it } from "vitest";
import { AppServerClient } from "./app-server-client.js";

describe("AppServerClient", () => {
  it("exposes a typed LodeCommands rpc client and closes without connecting", () => {
    const client = new AppServerClient({ url: "http://127.0.0.1:1" });
    expect(typeof client.rpc.createWorkspace).toBe("function");
    expect(typeof client.rpc.getNode).toBe("function");
    expect(typeof client.rpc.listenNotifications).toBe("function");
    client.close();
  });
});
