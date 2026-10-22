import { resolve } from "node:path";
import { createDaemonAuthority } from "./host/authority.js";
import { spawnDaemonProcess } from "./host/daemon-process.js";
import { DesktopHost } from "./host/desktop-host.js";
import { resolveDesktopHome } from "./host/home.js";
import { startWebServer } from "./host/web-server.js";
export async function startWebApplication(assetsPort: number, port: number) {
  const selection = await resolveDesktopHome({ argv: process.argv, environment: process.env });
  const host = new DesktopHost(
    createDaemonAuthority((selection) => spawnDaemonProcess(selection, resolve("apps/desktop/dist/daemon.js"))),
  );
  const state = await host.start(selection);
  if (state.phase === "error") {
    await host.close();
    throw new Error(state.error ?? "Unable to start the application");
  }
  const server = await startWebServer(host, assetsPort, port);
  return {
    origin: server.origin,
    close: async () => {
      await server.close();
      await host.close();
    },
  };
}
