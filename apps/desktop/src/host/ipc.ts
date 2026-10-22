import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";
import { desktopChannels } from "../bridge/contract.cjs";
import type { DesktopHost } from "./desktop-host.js";
export function registerDesktopIpc(ipc: IpcMain, window: BrowserWindow, host: DesktopHost): () => void {
  ipc.handle(desktopChannels.request, (event, method: unknown, input: unknown) => {
    validateSender(event, window);
    if (typeof method !== "string") {
      throw new Error("Application operation must be text");
    }
    return host.request(method, input);
  });
  const unsubscribe = host.onApplicationEvent((event) => {
    if (!window.isDestroyed()) {
      window.webContents.send(desktopChannels.event, event);
    }
  });
  return () => {
    unsubscribe();
    ipc.removeHandler(desktopChannels.request);
  };
}
function validateSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  const mainFrame = window.webContents.mainFrame;
  if (event.sender !== window.webContents || event.senderFrame !== mainFrame || !mainFrame.url.startsWith("file://")) {
    throw new Error("Desktop request did not originate from the packaged Lode renderer");
  }
}
