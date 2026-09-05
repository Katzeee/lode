import { app, ipcMain } from "electron";

import { createDaemonAuthority } from "./host/authority.js";
import { DesktopHost } from "./host/desktop-host.js";
import { resolveDesktopHome } from "./host/home.js";
import { registerDesktopIpc } from "./host/ipc.js";
import { join } from "node:path";
import { spawnDaemonProcess } from "./host/daemon-process.js";
import { VerificationReporter, verificationReportPath } from "./host/verification-report.js";
import { createDesktopWindow } from "./host/window.js";

void runDesktop().catch((error: unknown) => {
  process.stderr.write(`Desktop startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  app.exit(1);
});

async function runDesktop(): Promise<void> {
  // Calling the async lifecycle without top-level await lets Electron finish loading
  // the ESM entry point before it emits ready.
  await app.whenReady();

  const host = new DesktopHost(
    createDaemonAuthority((selection) =>
      spawnDaemonProcess(selection, join(app.getAppPath(), "dist", "daemon.js"), {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      }),
    ),
  );
  const reportPath = verificationReportPath(process.argv);
  const reporter = reportPath === null ? null : new VerificationReporter(reportPath, host.state());
  const window = await createDesktopWindow(app.getAppPath());
  const unregisterIpc = registerDesktopIpc(ipcMain, window, host);
  const unsubscribeReport =
    reporter === null ? () => undefined : host.subscribe((state) => reporter.stateChanged(state));
  let quitReady = false;
  let closing = false;

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitReady) {
      return;
    }
    event.preventDefault();
    void closeDesktop();
  });

  try {
    const selection = await resolveDesktopHome({ argv: process.argv, environment: process.env });
    await host.start(selection);
    await reporter?.flush();
  } catch (error) {
    host.fail(error);
    await reporter?.flush();
  }

  async function closeDesktop(): Promise<void> {
    if (quitReady || closing) {
      return;
    }
    closing = true;
    unregisterIpc();
    unsubscribeReport();
    try {
      const shutdown = await host.close();
      await reporter?.closed(shutdown);
    } catch (error) {
      process.stderr.write(`Desktop cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    } finally {
      quitReady = true;
      app.quit();
    }
  }
}
