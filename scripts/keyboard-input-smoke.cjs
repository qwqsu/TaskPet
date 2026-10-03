/**
 * Windows Raw Input 注册烟雾测试。
 * 创建一个隐藏的隔离窗口，注册并立即注销键盘设备；不记录或注入任何按键。
 */
const { app, BrowserWindow } = require("electron");
const { WindowsRawKeyboardSource } = require("../build/main/input/windows-raw-keyboard-source");

app.whenReady().then(() => {
  if (process.platform !== "win32") {
    console.log("TaskPet keyboard input smoke skipped (Windows only)");
    app.exit(0);
    return;
  }

  const window = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const source = new WindowsRawKeyboardSource(window, (error) => { throw error; });
  source.start(() => undefined);
  source.stop();
  window.destroy();
  console.log("TaskPet Windows raw keyboard input smoke ready");
  app.exit(0);
}).catch((error) => {
  console.error(`TaskPet keyboard input smoke failed: ${error.stack || error.message}`);
  app.exit(1);
});

