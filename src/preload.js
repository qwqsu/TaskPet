/**
 * 桌宠窗口的安全 preload bridge。
 * 页面没有 Node.js 权限，只能调用这里列出的拖拽、缩放、面板和订阅方法。
 */
const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  // 返回 unsubscribe，便于页面销毁时解除监听，避免重复订阅。
  if (typeof callback !== "function") return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("taskPet", {
  getInitialState: () => ipcRenderer.invoke("taskpet:get-initial-state"),
  getWindowBounds: () => ipcRenderer.invoke("taskpet:get-window-bounds"),
  startWindowDrag: () => ipcRenderer.send("taskpet:start-window-drag"),
  moveWindow: () => ipcRenderer.send("taskpet:move-window"),
  resizeWindow: (payload) => ipcRenderer.invoke("taskpet:resize-window", payload),
  finishDrag: () => ipcRenderer.invoke("taskpet:finish-drag"),
  toggleTaskPanel: () => ipcRenderer.invoke("taskpet:toggle-task-panel"),
  setDragDirection: (direction) => ipcRenderer.send("taskpet:drag-direction", direction),
  rendererReady: () => ipcRenderer.send("taskpet:renderer-ready"),
  onStateChange: (callback) => subscribe("taskpet:state-changed", callback),
  onPetChange: (callback) => subscribe("taskpet:pet-changed", callback),
  onZoomChange: (callback) => subscribe("taskpet:zoom-changed", callback)
});
