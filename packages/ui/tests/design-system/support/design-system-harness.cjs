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
  // Playwright stability checks need foreground-rate animation frames. Chromium considers a hidden
  // window backgrounded, so the harness stays compositor-visible but outside the desktop and taskbar.
  const window = new BrowserWindow({
    frame: false,
    height: 900,
    show: true,
    skipTaskbar: true,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
    width: 1280,
    x: -10_000,
    y: -10_000,
  });
  await window.loadFile(documentPath);
});
