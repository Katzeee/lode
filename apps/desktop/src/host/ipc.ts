import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";

import {
  desktopChannels,
  parseInitializeHomeInput,
  parsePassphrase,
  parseWorkspaceLabel,
} from "../bridge/contract.cjs";
import type { DesktopHost } from "./desktop-host.js";

export function registerDesktopIpc(ipc: IpcMain, window: BrowserWindow, host: DesktopHost): () => void {
  ipc.handle(desktopChannels.state, (event) => {
    validateSender(event, window);
    return host.state();
  });
  ipc.handle(desktopChannels.initializeHome, async (event, value: unknown) => {
    validateSender(event, window);
    return host.initializeHome(parseInitializeHomeInput(value));
  });
  ipc.handle(desktopChannels.unlockVault, async (event, value: unknown) => {
    validateSender(event, window);
    return host.unlockVault(parsePassphrase(value));
  });
  ipc.handle(desktopChannels.createWorkspace, async (event, value: unknown) => {
    validateSender(event, window);
    return host.createWorkspace(parseWorkspaceLabel(value));
  });
  const unsubscribe = host.subscribe((state) => {
    if (!window.isDestroyed()) {
      window.webContents.send(desktopChannels.stateChanged, state);
    }
  });
  return () => {
    unsubscribe();
    for (const channel of [
      desktopChannels.state,
      desktopChannels.initializeHome,
      desktopChannels.unlockVault,
      desktopChannels.createWorkspace,
    ]) {
      ipc.removeHandler(channel);
    }
  };
}

function validateSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  const mainFrame = window.webContents.mainFrame;
  if (event.sender !== window.webContents || event.senderFrame !== mainFrame || !mainFrame.url.startsWith("file://")) {
    throw new Error("Desktop request did not originate from the packaged Lode renderer");
  }
}
