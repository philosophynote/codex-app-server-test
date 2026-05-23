import { contextBridge, ipcRenderer } from "electron";
import type { CodexDesktopApi, CodexEvent } from "../shared/codex.js";

const api: CodexDesktopApi = {
  start: () => ipcRenderer.invoke("codex:start") as ReturnType<CodexDesktopApi["start"]>,
  sendMessage: (text: string) =>
    ipcRenderer.invoke("codex:send-message", text) as Promise<{ accepted: boolean }>,
  interrupt: () => ipcRenderer.invoke("codex:interrupt") as Promise<{ interrupted: boolean }>,
  stop: () => ipcRenderer.invoke("codex:stop") as Promise<void>,
  getStatus: () => ipcRenderer.invoke("codex:get-status") as ReturnType<CodexDesktopApi["getStatus"]>,
  onEvent: (listener: (event: CodexEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: CodexEvent) => {
      listener(payload);
    };
    ipcRenderer.on("codex:event", wrapped);
    return () => {
      ipcRenderer.off("codex:event", wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("codexDesktop", api);
