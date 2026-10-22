import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
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
  await page.getByRole("button", { name: "Create node", exact: true }).click();
  await page.locator('[data-ui="outline-row-text"]').first().click();
  await page.locator('[data-ui="outline-editor"]').pressSequentially("Mobile persistent note");
  adb("shell", "uiautomator", "dump", "/sdcard/lode-verification-window.xml");
  const hierarchy = adb("shell", "cat", "/sdcard/lode-verification-window.xml");
  const webview = hierarchy.match(
    /<node[^>]*class="android.webkit.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u,
  );
  assert.ok(webview, "the native hierarchy supplies the WebView screen bounds");
  const input = await page.locator('[data-ui="outline-editor"]').boundingBox();
  assert.ok(input);
  const scale = (Number(webview[3]) - Number(webview[1])) / (await page.evaluate(() => innerWidth));
  adb(
    "shell",
    "input",
    "tap",
    String(Math.round(Number(webview[1]) + (input.x + input.width / 2) * scale)),
    String(Math.round(Number(webview[2]) + (input.y + input.height / 2) * scale)),
  );
  assert.match(
    adb("shell", "dumpsys", "input_method"),
    /mIsInputViewShown=true/u,
    "touch editing shows the Android keyboard",
  );
  await page.locator('[data-ui="outline-editor"]').press("End");
  adb("shell", "input", "keyevent", "66");
  adb("shell", "input", "text", "Second%smobile%snode");
  await page.locator('[data-ui="outline-editor"]').filter({ hasText: "Second mobile node" }).waitFor();
  await mkdir("apps/mobile/build", { recursive: true });
  await writeFile(resolve("apps/mobile/build/keyboard-verification.png"), await androidDevice.screenshot());
  adb("shell", "input", "keyevent", "4");
  await page.locator('[data-ui="document-navigation"]').click({ position: { x: 4, y: 4 } });
  await page.getByText("Saved locally", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("tree", { name: "Workspace nodes", exact: true })
      .locator('[data-ui="outline-row"]')
      .first()
      .evaluate((row) => {
        const bullet = row.querySelector('[data-ui="outline-bullet"]')?.getBoundingClientRect();
        const text = row.querySelector('[data-ui="outline-row-text"]')?.getBoundingClientRect();
        return !!bullet && !!text && bullet.right <= text.left;
      }),
    true,
    "touch styles preserve the bullet gutter instead of moving disclosure into normal flow",
  );
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
  await connection.page.getByText("Second mobile node", { exact: true }).waitFor();
  process.stdout.write(
    "Android verification passed: shared onboarding, recovery, Worker editing, native SQLite persistence and process restart.\n",
  );
} finally {
  await androidDevice.close();
}
