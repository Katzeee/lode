import { catalogPages } from "../../../design-system-catalog/dist/index.js";
import { designSystemTest } from "./support/browser.mjs";
import { verifyCatalogAccessibility } from "./support/catalog-accessibility.mjs";

designSystemTest(`all ${String(catalogPages.length)} catalog pages are accessible`, async (page) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await verifyCatalogAccessibility(page, catalogPages);

  // Expanded navigation and responsive templates expose different DOM, so they earn a second scan.
  const expandedPages = catalogPages.filter((candidate) =>
    ["", "templates/layouts", "templates/product"].includes(candidate.path),
  );
  await page.setViewportSize({ height: 900, width: 1280 });
  await verifyCatalogAccessibility(page, expandedPages);
});
