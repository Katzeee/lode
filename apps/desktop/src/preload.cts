import { contextBridge, ipcRenderer } from "electron";

import { desktopChannels, type DesktopBridge, type DesktopState } from "./bridge/contract.cjs";

const bridge: DesktopBridge = {
  getState: () => ipcRenderer.invoke(desktopChannels.state) as Promise<DesktopState>,
  initializeHome: (input) => ipcRenderer.invoke(desktopChannels.initializeHome, input),
  unlockVault: (passphrase) => ipcRenderer.invoke(desktopChannels.unlockVault, passphrase),
  createWorkspace: (label) => ipcRenderer.invoke(desktopChannels.createWorkspace, label),
  onStateChanged: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, state: DesktopState) => listener(state);
    ipcRenderer.on(desktopChannels.stateChanged, receive);
    return () => ipcRenderer.removeListener(desktopChannels.stateChanged, receive);
  },
};

contextBridge.exposeInMainWorld("lode", bridge);
