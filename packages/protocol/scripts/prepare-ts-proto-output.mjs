import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../src/dto-gen/google/protobuf/struct.ts", import.meta.url);
const source = await readFile(path, "utf8");

if (!source.startsWith("// @ts-nocheck")) {
  await writeFile(path, `// @ts-nocheck -- ts-proto 2.12 emits incompatible nullable WKT helper internals.\n${source}`);
}
