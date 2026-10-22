import { spawnSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const supportDirectory = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(supportDirectory, "..", "..", "..");
const repositoryRoot = resolve(uiRoot, "..", "..");
const fixture = join(uiRoot, "tests", "design-system", "fixture");
const output = join(uiRoot, "build", "design-system-test");
const assets = join(repositoryRoot, "packages", "design-tokens", "assets");
const require = createRequire(import.meta.url);
const tailwindCli = join(dirname(require.resolve("@tailwindcss/cli/package.json")), "dist", "index.mjs");

assertTestOutput();

export default async function setup() {
  await rm(output, { force: true, recursive: true });
  await mkdir(output, { recursive: true });

  const tailwind = spawnSync(
    process.execPath,
    [tailwindCli, "-i", join(fixture, "catalog.css"), "-o", join(output, "catalog.css"), "--minify"],
    { cwd: uiRoot, stdio: "inherit" },
  );
  if (tailwind.status !== 0) {
    throw new Error("Design-system test CSS build failed");
  }

  await Promise.all([
    build({
      bundle: true,
      define: { "process.env.NODE_ENV": '"production"' },
      entryPoints: [join(fixture, "renderer.tsx")],
      external: ["./assets/*"],
      format: "esm",
      legalComments: "none",
      loader: { ".tsx": "tsx" },
      logLevel: "warning",
      minify: true,
      outfile: join(output, "renderer.js"),
      platform: "browser",
      sourcemap: false,
      target: ["chrome142"],
    }),
    cp(join(fixture, "index.html"), join(output, "index.html")),
    cp(assets, join(output, "assets"), { recursive: true }),
  ]);

  return async () => {
    assertTestOutput();
    await rm(output, { force: true, recursive: true });
  };
}

function assertTestOutput() {
  const local = relative(uiRoot, output);
  if (local !== join("build", "design-system-test")) {
    throw new Error(`Refusing to manage unexpected test output: ${output}`);
  }
}
