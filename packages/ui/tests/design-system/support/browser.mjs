import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { _electron } from "playwright-core";
import { afterAll, test } from "vitest";

import { catalogPages } from "../../../../design-system-catalog/dist/index.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..", "..", "..", "..", "..");
const documentPath = join(repositoryRoot, "packages", "ui", "build", "design-system-test", "index.html");
const harnessPath = join(testDirectory, "design-system-harness.cjs");
const documentUrl = pathToFileURL(documentPath).href;
let applicationPromise;
let pagePromise;

afterAll(async () => {
  const application = await applicationPromise;
  await application?.close();
  applicationPromise = undefined;
  pagePromise = undefined;
});

export function designSystemTest(name, run) {
  test(name, async () => {
    const page = await designSystemPage();
    await page.setViewportSize({ height: 900, width: 1280 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(documentUrl, { waitUntil: "load" });
    await run(page);
  });
}

async function designSystemPage() {
  applicationPromise ??= _electron.launch({ args: [harnessPath, documentPath], cwd: repositoryRoot });
  pagePromise ??= applicationPromise.then((application) => application.firstWindow({ timeout: 30_000 }));
  return pagePromise;
}

export async function navigateToCatalogPage(page, path) {
  const catalogPage = catalogPages.find((candidate) => candidate.path === path);
  if (catalogPage === undefined) {
    throw new Error(`Unknown design-system catalog path: ${path}`);
  }
  await page.evaluate(
    (hash) => {
      window.location.hash = hash;
    },
    path === "" ? "#/design-system" : `#/design-system/${path}`,
  );
  await page
    .getByRole("heading", { exact: true, level: 1, name: path === "" ? "Lode Design System" : catalogPage.title })
    .waitFor({ state: "visible" });
}
