import { catalogPages } from "../../../design-system-catalog/dist/index.js";
import { designSystemTest } from "./support/browser.mjs";
import { verifyCatalogAccessibility } from "./support/catalog-accessibility.mjs";

designSystemTest(`all ${String(catalogPages.length)} catalog pages are accessible`, async (page) => {
  await verifyCatalogAccessibility(page);
  await page.setViewportSize({ height: 844, width: 390 });
  await verifyCatalogAccessibility(page);
});
