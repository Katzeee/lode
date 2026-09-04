import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { catalogPages } from "../../../../design-system-catalog/dist/index.js";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

export async function verifyCatalogAccessibility(page) {
  await page.addInitScript({ path: axePath });
  await page.reload({ waitUntil: "networkidle" });
  await navigate(page, catalogPages[0]);

  for (const catalogPage of catalogPages) {
    await navigate(page, catalogPage);
    const results = await page.evaluate(async () => {
      if (!("axe" in window)) {
        throw new Error("axe-core is unavailable in the catalog document");
      }
      return window.axe.run(document, {
        resultTypes: ["violations"],
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
    });
    assert.deepEqual(
      results.violations,
      [],
      `${catalogPage.title} has accessibility violations:\n${formatViolations(results.violations)}`,
    );
  }
}

async function navigate(page, catalogPage) {
  const path = catalogPage.path === "" ? "" : `/${catalogPage.path}`;
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#/design-system${path}`);
  await page.locator("main h1").first().waitFor({ state: "visible" });
}

function formatViolations(violations) {
  return violations
    .map(
      (violation) =>
        `${violation.id}: ${violation.help}\n${violation.nodes
          .map((node) => `  ${node.target.join(" ")} — ${node.failureSummary ?? "No failure summary"}`)
          .join("\n")}`,
    )
    .join("\n");
}
