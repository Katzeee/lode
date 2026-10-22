import { spawnSync } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const designAssets = resolve(appRoot, "../../packages/design-tokens/assets");
const source = join(appRoot, "src");
const output = join(appRoot, "dist");
const require = createRequire(import.meta.url);
const tailwindCli = join(dirname(require.resolve("@tailwindcss/cli/package.json")), "dist/index.mjs");

await mkdir(output, { recursive: true });

const tailwind = spawnSync(
  process.execPath,
  [tailwindCli, "-i", join(source, "renderer/app.css"), "-o", join(output, "renderer.css"), "--minify"],
  { cwd: appRoot, stdio: "inherit" },
);
if (tailwind.status !== 0) {
  throw new Error("Tailwind CSS build failed");
}

const nodeBundle = {
  bundle: true,
  legalComments: "none",
  logLevel: "info",
  minify: false,
  packages: "bundle",
  platform: "node",
  sourcemap: false,
  target: "node22",
};

await Promise.all([
  build({ ...nodeBundle, entryPoints: [join(source, "web.ts")], format: "esm", outfile: join(output, "web.js") }),
  build({
    ...nodeBundle,
    entryPoints: [join(source, "main.ts")],
    external: ["electron"],
    format: "esm",
    outfile: join(output, "main.js"),
  }),
  build({
    ...nodeBundle,
    entryPoints: [join(source, "daemon.ts")],
    external: ["better-sqlite3"],
    format: "esm",
    outfile: join(output, "daemon.js"),
  }),
  build({
    ...nodeBundle,
    entryPoints: [join(source, "preload.cts")],
    external: ["electron"],
    format: "cjs",
    outfile: join(output, "preload.cjs"),
  }),
  build({
    bundle: true,
    // The design-system catalog loads through a dynamic import, so the
    // renderer ships as ES modules and the catalog splits into its own chunk.
    chunkNames: "chunks/[name]-[hash]",
    define: { "process.env.NODE_ENV": '"production"' },
    entryNames: "[name]",
    entryPoints: { renderer: join(source, "renderer.tsx") },
    external: ["./assets/*"],
    format: "esm",
    legalComments: "none",
    loader: { ".tsx": "tsx" },
    logLevel: "info",
    minify: true,
    outdir: output,
    platform: "browser",
    sourcemap: false,
    splitting: true,
    target: ["chrome142"],
  }),
]);

await cp(join(source, "index.html"), join(output, "index.html"));
await cp(designAssets, join(output, "assets"), { recursive: true });
