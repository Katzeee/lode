import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const packageRoot = resolve(process.cwd());
const output = resolve(packageRoot, "dist");

if (dirname(output) !== packageRoot || basename(output) !== "dist") {
  throw new Error(`Refusing to clean unexpected build output: ${output}`);
}

await rm(output, { recursive: true, force: true });
