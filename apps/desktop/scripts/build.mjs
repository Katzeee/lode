import { cp, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const source = join(appRoot, "src");
const output = join(appRoot, "dist");

await mkdir(output, { recursive: true });

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
    define: { "process.env.NODE_ENV": '"production"' },
    entryNames: "[name]",
    entryPoints: { renderer: join(source, "renderer.tsx") },
    legalComments: "none",
    loader: { ".tsx": "tsx" },
    logLevel: "info",
    minify: true,
    outdir: output,
    platform: "browser",
    sourcemap: false,
    target: ["chrome142"],
  }),
]);

await cp(join(source, "index.html"), join(output, "index.html"));
