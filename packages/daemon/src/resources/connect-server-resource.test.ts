import { once } from "node:events";
import { connect } from "node:http2";

import { describe, expect, it } from "vitest";

import type { EngineApi } from "@lode/sdk/host";
import { parseEndpoint } from "@lode/sdk";
import { ConnectServerResource } from "./connect-server-resource.js";

const status = { homeName: "test", daemonVersion: "test", homePath: "test" };

describe("ConnectServerResource", () => {
  it("closes an idle Client Session before closing its listener", async () => {
    const resource = connectServerResource(0);
    await resource.start();
    const session = connect(resource.address);
    session.on("error", () => {});
    await once(session, "connect");
    const closed = new Promise<void>((resolve) => session.once("close", resolve));

    await expect(resource.close()).resolves.toBeUndefined();
    await closed;
  });
});

function connectServerResource(port: number): ConnectServerResource {
  return new ConnectServerResource({} as EngineApi, parseEndpoint(`tcp://127.0.0.1:${port}`), "token", status);
}
