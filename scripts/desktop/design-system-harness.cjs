const { app, BrowserWindow } = require("electron");

const documentPath = process.argv[2];
if (documentPath === undefined) {
  throw new Error("The design-system harness requires the built desktop document path");
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    frame: false,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    width: 1280,
  });
  await window.loadFile(documentPath);
});
