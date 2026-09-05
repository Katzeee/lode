import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _android } from "playwright-core";

const device = process.env.LODE_ANDROID_DEVICE;
if (!device) {
  throw new Error(
    "Set LODE_ANDROID_DEVICE to a dedicated test emulator or device with a fresh Lode Debug installation.",
  );
}
const sdk =
  process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.LOCALAPPDATA, "Android", "Sdk");
const adbPath = join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
await access(adbPath);
const appId = "com.lode.mobile.debug";
let androidDevice = (await _android.devices({ omitDriverInstall: true })).find(
  (candidate) => candidate.serial() === device,
);
assert.ok(androidDevice, "The selected device must be connected");
function adb(...args) {
  const result = spawnSync(adbPath, ["-s", device, ...args], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || String(result.error));
  }
  return result.stdout.trim();
}
async function connect() {
  adb("shell", "am", "start", "-W", "-n", `${appId}/com.lode.mobile.MainActivity`);
  const pid = adb("shell", "pidof", appId);
  const view = await androidDevice.webView(
    { pkg: appId, socketName: `webview_devtools_remote_${pid}` },
    { timeout: 30_000 },
  );
  return { page: await view.page() };
}
let connection;
try {
  connection = await connect();
  const page = connection.page;
  await page.getByRole("heading", { name: "Welcome to Lode", exact: true }).waitFor();
  await page.getByLabel("Your name", { exact: true }).fill("Mobile verification");
  await page.getByLabel("Passphrase", { exact: true }).fill("mobile-verification-passphrase");
  await page.getByRole("button", { name: "Create identity", exact: true }).click();
  await page.getByTestId("recovery-phrase").waitFor();
  await page.getByRole("button", { name: "I saved my recovery phrase" }).click();
  await page.getByLabel("Workspace name", { exact: true }).fill("Mobile workspace");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.getByRole("heading", { name: "Mobile workspace", exact: true }).waitFor();
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  await page.locator('[data-ui="outline-row-text"]').first().click();
  await page.locator('[data-ui="outline-editor"]').pressSequentially("Mobile persistent note");
  adb("shell", "input", "keyevent", "4");
  await page.getByRole("heading", { name: "Mobile workspace", exact: true }).click();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mkdir("apps/mobile/build", { recursive: true });
  await page.screenshot({ path: resolve("apps/mobile/build/application-verification.png") });
  await androidDevice.close();
  adb("shell", "am", "force-stop", appId);
  connection = undefined;
  androidDevice = (await _android.devices({ omitDriverInstall: true })).find(
    (candidate) => candidate.serial() === device,
  );
  assert.ok(androidDevice);
  connection = await connect();
  await connection.page.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();
  await connection.page.getByLabel("Passphrase", { exact: true }).fill("mobile-verification-passphrase");
  await connection.page.getByRole("button", { name: "Unlock", exact: true }).click();
  await connection.page.getByText("Mobile persistent note", { exact: true }).waitFor();
  process.stdout.write(
    "Android verification passed: shared onboarding, recovery, Worker editing, native SQLite persistence and process restart.\n",
  );
} finally {
  await androidDevice.close();
}
