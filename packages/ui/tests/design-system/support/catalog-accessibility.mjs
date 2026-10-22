import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { navigateToCatalogPage } from "./browser.mjs";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

export async function verifyCatalogAccessibility(page, pages) {
  if (!(await page.evaluate(() => "axe" in window))) {
    await page.addScriptTag({ path: axePath });
  }

  for (const catalogPage of pages) {
    await navigateToCatalogPage(page, catalogPage.path);
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
