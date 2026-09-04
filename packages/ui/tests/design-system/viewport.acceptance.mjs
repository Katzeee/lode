import assert from "node:assert/strict";

import { catalogPages } from "../../../design-system-catalog/dist/index.js";
import { tokens } from "../../../design-tokens/dist/index.js";
import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

// Horizontal fit changes only when a layout tier begins. The narrowest width in each tier is the
// strongest overflow case; device-height behavior belongs to the focused overlay acceptance test.
const layoutBoundaryViewports = [
  { height: 568, label: "minimum compact width", width: 320 },
  { height: 800, label: "minimum medium width", width: tokens.layout.breakpoint.medium },
  { height: 800, label: "minimum expanded width", width: tokens.layout.breakpoint.expanded },
  { height: 800, label: "minimum large width", width: tokens.layout.breakpoint.large },
];

designSystemTest(
  `the catalog fits all ${String(layoutBoundaryViewports.length)} layout boundaries`,
  verifyDeviceViewports,
);

async function verifyDeviceViewports(page) {
  for (const viewport of layoutBoundaryViewports) {
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
  }
}
