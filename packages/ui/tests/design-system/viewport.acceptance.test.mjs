import assert from "node:assert/strict";

import { catalogPages } from "../../../design-system-catalog/dist/index.js";
import { tokens } from "../../../design-tokens/dist/index.js";
import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";
import { deviceViewports } from "./support/device-viewports.mjs";

designSystemTest(
  `the catalog and shell fit ${String(deviceViewports.length)} representative device viewports`,
  verifyDeviceViewports,
);

async function verifyDeviceViewports(page) {
  for (const viewport of deviceViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    for (const catalogPage of catalogPages) {
      await navigateToCatalogPage(page, catalogPage.path);
      const measurement = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        offenders: [...document.querySelectorAll("body *")]
          .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .slice(0, 3)
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}.${element.className}:${element.textContent?.trim().slice(0, 40) ?? ""}`,
          ),
      }));
      assert.ok(
        measurement.overflow <= 1,
        `${catalogPage.title} overflows the ${viewport.label} viewport by ${String(measurement.overflow)}px: ${measurement.offenders.join(", ")}`,
      );
    }
    await verifyShellTier(page, viewport);
  }
}

async function verifyShellTier(page, viewport) {
  await navigateToCatalogPage(page, "templates/product");
  await page.locator('[data-ui="app-shell"]').first().waitFor({ state: "visible" });
  // The product template nests the previewed product shell inside the
  // catalog's own shell; each one must pick the tier its container mandates.
  const shells = await page.evaluate(() =>
    [...document.querySelectorAll('[data-ui="app-shell"]')].map((element) => ({
      visible: [...element.querySelectorAll("[data-layout]")]
        .filter((candidate) => candidate.closest('[data-ui="app-shell"]') === element)
        .filter((candidate) => candidate.checkVisibility())
        .map((candidate) => candidate.dataset.layout),
      width: element.getBoundingClientRect().width,
    })),
  );
  assert.equal(shells.length, 2, `the product template must render the catalog shell and the previewed shell`);
  const { expanded, medium } = tokens.layout.breakpoint;
  for (const shell of shells) {
    const expectedTier = shell.width >= expanded ? "expanded" : shell.width >= medium ? "medium" : "compact";
    assert.deepEqual(
      shell.visible,
      [expectedTier],
      `the ${viewport.label} viewport must show only the ${expectedTier} navigation tier for a ${String(Math.round(shell.width))}px shell container`,
    );
  }
}
