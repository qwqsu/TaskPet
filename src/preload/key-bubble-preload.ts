/** 按键气泡窗口仅接收已映射的短标签，不接收原始输入或历史。 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("taskPetKeyBubbles", Object.freeze({
  ready: (): void => ipcRenderer.send("taskpet:key-bubbles:ready"),
  empty: (sequence: number): void => {
    if (Number.isSafeInteger(sequence)) {
      ipcRenderer.send("taskpet:key-bubbles:empty", sequence);
    }
  },
  onPush: (callback: (event: { label: string; sequence: number }) => void): (() => void) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (!payload || typeof payload !== "object") return;
      const { label, sequence } = payload as { label?: unknown; sequence?: unknown };
      if (typeof label === "string" && Number.isSafeInteger(sequence)) {
        callback({ label: label.slice(0, 16), sequence: sequence as number });
      }
    };
    ipcRenderer.on("taskpet:key-bubbles:push", listener);
    return () => ipcRenderer.removeListener("taskpet:key-bubbles:push", listener);
  }
}));
