import assert from "node:assert/strict";

import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

designSystemTest("the compact catalog drawer navigates and closes", verifyCatalogDrawer);

async function verifyCatalogDrawer(page) {
  await page.setViewportSize({ height: 844, width: 390 });
  await navigateToCatalogPage(page, "");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Lode Design System navigation" });
  await drawer.waitFor({ state: "visible" });
  await drawer.getByRole("link", { name: "Buttons" }).click();
  await drawer.waitFor({ state: "detached" });
  await page.locator("main h1").first().waitFor({ state: "visible" });
  assert.equal(
    await page.locator("main h1").first().textContent(),
    "Buttons",
    "selecting a drawer destination must navigate and close the drawer",
  );
}
