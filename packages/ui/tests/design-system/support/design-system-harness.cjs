const { app, BrowserWindow } = require("electron");

const documentPath = process.argv[2];
if (documentPath === undefined) {
  throw new Error("The design-system harness requires the built catalog document path");
}

app.disableHardwareAcceleration();
// Phone-class viewports in the matrix assume the overlay scrollbars real
// mobile WebViews use; classic scrollbars would steal gutter width and
// report false horizontal overflow at the 320px floor.
app.commandLine.appendSwitch("enable-features", "OverlayScrollbar");
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
