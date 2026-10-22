import { contextBridge, ipcRenderer } from "electron";
import type { ApplicationConnection, ApplicationEvent } from "@lode/application/host";
import { desktopChannels } from "./bridge/contract.cjs";
const connection: ApplicationConnection = {
  request: (method, input) => ipcRenderer.invoke(desktopChannels.request, method, input) as Promise<unknown>,
  subscribe: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, event: ApplicationEvent) => listener(event);
    ipcRenderer.on(desktopChannels.event, receive);
    return () => ipcRenderer.removeListener(desktopChannels.event, receive);
  },
};
contextBridge.exposeInMainWorld("lode", connection);
