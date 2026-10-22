import { spawn } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build, context } from "esbuild";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const source = join(appRoot, "src");
const output = join(appRoot, "build", "web-preview");
const designAssets = resolve(appRoot, "../../packages/design-tokens/assets");
const designCatalogEntry = resolve(appRoot, "../../packages/design-system-catalog/src/index.ts");
const designTokensEntry = resolve(appRoot, "../../packages/design-tokens/src/index.ts");
const uiEntry = resolve(appRoot, "../../packages/ui/src/index.ts");
const uiCatalogEntry = resolve(appRoot, "../../packages/ui/src/catalog/index.ts");
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
    "@lode/application": resolve(appRoot, "../../packages/application/src/index.ts"),
    "@lode/application/host": resolve(appRoot, "../../packages/application/src/host.ts"),
    "@lode/design-system-catalog": designCatalogEntry,
    "@lode/design-tokens": designTokensEntry,
    "@lode/ui": uiEntry,
    "@lode/ui/catalog": uiCatalogEntry,
  },
  bundle: true,
  chunkNames: "chunks/[name]-[hash]",
  define: { "process.env.NODE_ENV": '"development"' },
  entryPoints: { renderer: join(source, "renderer.tsx") },
  external: ["./assets/*"],
  format: "esm",
  legalComments: "none",
  loader: { ".tsx": "tsx" },
  logLevel: "info",
  minify: false,
  outdir: output,
  platform: "browser",
  sourcemap: true,
  splitting: true,
  target: ["chrome142"],
});

await buildContext.watch();
const port = Number(process.env.LODE_PREVIEW_PORT ?? "4173");
const assets = await buildContext.serve({ host: "127.0.0.1", port: 0, servedir: output });
await build({
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["better-sqlite3"],
  entryPoints: { web: join(source, "web.ts"), daemon: join(source, "daemon.ts") },
  outdir: join(appRoot, "dist"),
});
const { startWebApplication } = await import(pathToFileURL(join(appRoot, "dist/web.js")).href);
const application = await startWebApplication(assets.port, port);
process.stdout.write(`Lode: ${application.origin}/\n`);

const stop = async () => {
  await application.close();
  tailwind.kill();
  await buildContext.dispose();
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

process.on("message", (message) => {
  if (message === "stop") {
    void stop();
  }
});

await new Promise(() => undefined);
