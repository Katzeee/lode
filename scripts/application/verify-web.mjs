import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { probeDaemon, writeHomeRegistry } from "@lode/desktop-client";

const temporary = await mkdtemp(join(tmpdir(), "lode-application-web-"));
const home = { name: "verification", path: join(temporary, "home") };
const port = "0";
let origin;
const server = spawn(
  process.execPath,
  ["apps/desktop/scripts/dev-web.mjs", "--lode-home-path", home.path, "--lode-home-name", home.name],
  { env: { ...process.env, LODE_PREVIEW_PORT: port }, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true },
);
let log = "";
server.stdout.on("data", (chunk) => {
  log += String(chunk);
});
server.stderr.on("data", (chunk) => {
  log += String(chunk);
});
const exited = new Promise((resolve) => server.once("exit", resolve));
let browser;
let daemon;
try {
  const deadline = Date.now() + 60_000;
  while (!log.includes("Lode: http")) {
    if (server.exitCode !== null || Date.now() > deadline) {
      throw new Error(log);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  origin = log.match(/Lode: (http:\/\/127\.0\.0\.1:\d+)/)[1];
  let executable = process.env.LODE_BROWSER_EXECUTABLE;
  if (!executable && process.platform === "win32") {
    for (const candidate of [
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    ]) {
      if (
        await access(candidate).then(
          () => true,
          () => false,
        )
      ) {
        executable = candidate;
        break;
      }
    }
  }
  browser = await chromium.launch({ executablePath: executable, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/`);
  await page.getByLabel("Your name", { exact: true }).fill("Verification");
  await page.getByLabel("Passphrase", { exact: true }).fill("verification-passphrase");
  await page.getByRole("button", { name: "Create identity", exact: true }).click();
  await page.getByTestId("recovery-phrase").waitFor();
  assert.ok((await page.getByTestId("recovery-phrase").textContent()).trim().split(/\s+/).length >= 12);
  await page.getByRole("button", { name: "I saved my recovery phrase" }).click();
  await page.getByLabel("Workspace name", { exact: true }).fill("Shared workspace");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).waitFor();
  await page.getByRole("button", { name: "Add node", exact: true }).click();
  const row = page
    .locator('[data-ui="outline-row"]')
    .filter({ has: page.locator('[data-ui="outline-row-text"]') })
    .last();
  await row.locator('[data-ui="outline-row-text"]').click();
  await page.locator('[data-ui="outline-editor"]').pressSequentially("A shared note");
  await page.getByRole("heading", { name: "Shared workspace" }).click();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  daemon = await probeDaemon(home);
  assert.ok(daemon);
  const workspaces = await daemon.client.listWorkspaces();
  const workspaceId = workspaces[0].workspaceId;
  const nodes = await daemon.client.query({
    kind: "projection",
    workspaceId,
    perspective: "origin",
    section: "nodes",
    limit: 100,
  });
  assert.equal(nodes.status, "ok");
  const node = Object.values(nodes.value.nodes).find(
    (node) => node.content.map((part) => (part.kind === "text" ? part.value : "")).join("") === "A shared note",
  );
  assert.ok(node, "GUI edits must reach the daemon projection");
  const configDir = join(temporary, "config");
  await writeHomeRegistry(configDir, (document) => {
    document.default_home = home.name;
    document.homes = { [home.name]: { path: home.path } };
  });
  const cli = spawnSync(
    process.execPath,
    [
      "apps/cli/dist/bin/lode.js",
      "--home",
      home.name,
      "--workspace",
      `workspace:${workspaceId}`,
      "--format",
      "json",
      "node",
      "show",
      `node:${node.nodeId}`,
    ],
    { env: { ...process.env, LODE_CONFIG_DIR: configDir }, encoding: "utf8", windowsHide: true },
  );
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  assert.match(cli.stdout, /A shared note/);
  const second = await context.newPage();
  second.on("pageerror", (error) => errors.push(error.message));
  await second.goto(`${origin}/`);
  await second
    .getByText("A shared note", { exact: true })
    .waitFor()
    .catch(async (error) => {
      process.stderr.write(JSON.stringify({ body: await second.locator("body").innerText(), errors }) + "\n");
      throw error;
    });
  await second.setViewportSize({ width: 390, height: 844 });
  assert.equal(await second.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.reload();
  await page.getByText("A shared note", { exact: true }).waitFor();
  const actor = (await daemon.client.listActors()).actors.find((actor) => actor.unlocked);
  const result = await daemon.client.execute({
    kind: "edit",
    workspaceId,
    actorId: actor.actorId,
    invocationId: crypto.randomUUID(),
    historyChannelId: "verification-client",
    intent: "direct",
    actions: [
      {
        kind: "rich-text-splice",
        nodeId: node.nodeId,
        deleteAtomIds: [],
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        insert: " from another client",
      },
    ],
  });
  assert.equal(result.status, "published");
  await page.getByText("A shared note from another client", { exact: true }).waitFor();
  await second.getByText("A shared note from another client", { exact: true }).waitFor();
  const denied = await fetch(`${origin}/api/application`, {
    method: "POST",
    headers: { origin: "https://example.com", "content-type": "application/json" },
    body: JSON.stringify({ method: "state" }),
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(errors, []);
  server.send("stop");
  await exited;
  assert.ok(
    await probeDaemon(home).then((connection) => {
      connection?.client.close();
      return connection !== null;
    }),
    "Closing Web must leave the shared daemon alive",
  );
  process.stdout.write(
    "Web verification passed: onboarding, recovery, workspace, node editing, refresh, narrow layout, CLI visibility, shared daemon events and origin isolation.\n",
  );
} catch (error) {
  process.stderr.write(String(error) + "\n" + log.slice(-1500) + "\n");
  throw error;
} finally {
  await browser?.close();
  daemon ??= await probeDaemon(home).catch(() => null);
  if (daemon) {
    await daemon.client.shutdown().catch(() => undefined);
    daemon.client.close();
  }
  if (server.exitCode === null) {
    server.send("stop");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (server.exitCode === null) {
      server.kill();
    }
  }
  const target = resolve(temporary);
  if (!target.startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/"))) {
    throw new Error("Unexpected verification directory");
  }
  for (let i = 0; i < 100; i += 1) {
    if (
      !(await access(join(home.path, "daemon.lock")).then(
        () => true,
        () => false,
      ))
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
