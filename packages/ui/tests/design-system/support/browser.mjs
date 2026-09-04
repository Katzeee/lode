import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron } from "playwright-core";
import { test } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..", "..", "..", "..", "..");
const documentPath = join(repositoryRoot, "packages", "ui", "build", "design-system-test", "index.html");
const harnessPath = join(testDirectory, "design-system-harness.cjs");

export function designSystemTest(name, run) {
  test(name, async () => {
    const application = await _electron.launch({ args: [harnessPath, documentPath], cwd: repositoryRoot });
    try {
      const page = await application.firstWindow({ timeout: 30_000 });
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await run(page);
    } finally {
      await application.close();
    }
  });
}

export async function navigateToCatalogPage(page, path) {
  await page.evaluate(
    (hash) => {
      window.location.hash = hash;
    },
    path === "" ? "#/design-system" : `#/design-system/${path}`,
  );
  await page.locator("main h1").first().waitFor({ state: "visible" });
}
