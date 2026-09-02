import { spawn } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { context } from "esbuild";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const source = join(appRoot, "src");
const output = join(appRoot, "build", "web-preview");
const designAssets = resolve(appRoot, "../../packages/design-tokens/assets");
const designCatalogEntry = resolve(appRoot, "../../packages/design-system-catalog/src/index.ts");
const designTokensEntry = resolve(appRoot, "../../packages/design-tokens/src/index.ts");
const require = createRequire(import.meta.url);
const tailwindCli = join(dirname(require.resolve("@tailwindcss/cli/package.json")), "dist/index.mjs");

await mkdir(output, { recursive: true });
await Promise.all([
  cp(join(source, "design-system-preview.html"), join(output, "index.html")),
  cp(designAssets, join(output, "assets"), { force: true, recursive: true }),
]);

const tailwind = spawn(
  process.execPath,
  [tailwindCli, "-i", join(source, "renderer/app.css"), "-o", join(output, "renderer.css"), "--watch=always"],
  { cwd: appRoot, stdio: "inherit" },
);

const buildContext = await context({
  alias: {
    "@lode/design-system-catalog": designCatalogEntry,
    "@lode/design-tokens": designTokensEntry,
  },
  bundle: true,
  define: { "process.env.NODE_ENV": '"development"' },
  entryPoints: { renderer: join(source, "renderer.tsx") },
  external: ["./assets/*"],
  legalComments: "none",
  loader: { ".tsx": "tsx" },
  logLevel: "info",
  minify: false,
  outdir: output,
  platform: "browser",
  sourcemap: true,
  target: ["chrome142"],
});

await buildContext.watch();
const port = Number(process.env.LODE_PREVIEW_PORT ?? "4173");
const server = await buildContext.serve({ host: "127.0.0.1", port, servedir: output });
process.stdout.write(`Lode Design System: http://127.0.0.1:${String(server.port)}/#/design-system\n`);

const stop = async () => {
  tailwind.kill();
  await buildContext.dispose();
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await new Promise(() => undefined);
