import assert from "node:assert/strict";

import { designSystemTest } from "./support/browser.mjs";

designSystemTest("responsive patterns select the correct layout", verifyResponsivePatterns);

async function verifyResponsivePatterns(page) {
  await page.evaluate(() => {
    window.location.hash = "#/design-system/templates/product";
  });
  const shell = page.locator('main [data-ui="app-shell"]');
  await shell.waitFor({ state: "visible" });
  for (const [width, expected] of [
    [500, "compact"],
    [700, "medium"],
    [900, "expanded"],
  ]) {
    await shell.evaluate((element, nextWidth) => {
      element.style.width = `${nextWidth}px`;
    }, width);
    await shell.locator(`[data-layout="${expected}"]`).waitFor({ state: "visible" });
    const visibleTiers = await shell.locator("[data-layout]:visible").count();
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
