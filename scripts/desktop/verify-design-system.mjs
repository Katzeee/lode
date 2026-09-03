import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron } from "playwright-core";

import { catalogPages } from "../../packages/design-system-catalog/dist/index.js";
import { verifyCatalogAccessibility } from "./catalog-accessibility.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const documentPath = join(repositoryRoot, "apps", "desktop", "dist", "index.html");
const harnessPath = join(scriptDirectory, "design-system-harness.cjs");
const application = await _electron.launch({ args: [harnessPath, documentPath], cwd: repositoryRoot });

try {
  const page = await application.firstWindow({ timeout: 30_000 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await verifyCatalogAccessibility(page);
  await verifyResponsivePatterns(page);
  process.stdout.write(`Verified ${catalogPages.length} accessible catalog pages and the responsive layout tiers.\n`);
} finally {
  await application.close();
}

async function verifyResponsivePatterns(page) {
  await page.evaluate(() => {
    window.location.hash = "#/design-system/templates/product";
  });
  const shell = page.locator('[data-ui="app-shell"]');
  await shell.waitFor({ state: "visible" });
  for (const [width, expected] of [
    [500, "compact"],
    [700, "medium"],
    [900, "expanded"],
  ]) {
    await shell.evaluate((element, nextWidth) => {
      element.style.width = `${nextWidth}px`;
    }, width);
    await page.locator(`[data-layout="${expected}"]`).waitFor({ state: "visible" });
    const visibleTiers = await page.locator('[data-ui="app-shell"] [data-layout]:visible').count();
    assert.equal(visibleTiers, 1, `${String(width)}px must expose only the ${expected} navigation tier`);
  }

  await page.evaluate(() => {
    window.location.hash = "#/design-system/templates/layouts";
  });
  const pattern = page.locator('[data-ui="list-detail"]');
  await pattern.waitFor({ state: "visible" });
  await pattern.evaluate((element) => {
    element.style.width = "500px";
  });
  await pattern.locator('[data-pane="list"]').waitFor({ state: "visible" });
  assert.equal(await pattern.locator('[data-pane="detail"]').isVisible(), false);
  await pattern.getByRole("button", { name: /Field notes/u }).click();
  await pattern.locator('[data-pane="detail"]').waitFor({ state: "visible" });
  assert.equal(await pattern.locator('[data-pane="list"]').isVisible(), false);
  await pattern.getByRole("button", { name: "← Back to list" }).click();
  await pattern.locator('[data-pane="list"]').waitFor({ state: "visible" });
  await pattern.evaluate((element) => {
    element.style.width = "900px";
  });
  await pattern.locator('[data-pane="detail"]').waitFor({ state: "visible" });
  assert.equal(await pattern.locator('[data-pane="list"]').isVisible(), true);
}
