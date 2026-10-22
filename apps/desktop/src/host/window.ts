import { BrowserWindow } from "electron";
import { join } from "node:path";
import { tokens } from "@lode/design-tokens";

export async function createDesktopWindow(appPath: string): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    backgroundColor: tokens.color.sys.light.background,
    height: 760,
    minHeight: 560,
    minWidth: 760,
    show: false,
    title: "Lode",
    width: 1080,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(appPath, "dist", "preload.cjs"),
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
    }
  });
  await window.loadFile(join(appPath, "dist", "index.html"));
  window.show();
  return window;
}
