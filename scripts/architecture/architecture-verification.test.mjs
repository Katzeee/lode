import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ESLint } from "eslint";
import { analyzeRepositoryArchitecture } from "./index.mjs";

test("accepts an acyclic reachable workspace", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts": 'export { value } from "./value.js";\n',
      "packages/a/src/value.ts": "export const value = 1;\n",
    },
    async (result) => assert.deepEqual(result.diagnostics, []),
  );
});

test("rejects runtime cycles through every supported module syntax", async (t) => {
  const importers = {
    "dynamic import": "export const value = import(`./index.js`);\n",
    "import equals": 'import root = require("./index.js"); export const value = root;\n',
    "require call": 'export const value = require("./index.js");\n',
    "static import": 'import { root } from "./index.js"; export const value = root;\n',
  };
  for (const [name, importer] of Object.entries(importers)) {
    await t.test(name, async () => {
      await withFixture(
        {
          "packages/a/src/index.ts": 'import { value } from "./value.js"; export const root = value;\n',
          "packages/a/src/value.ts": importer,
        },
        async (result) => assert.deepEqual(categories(result), ["runtime import cycle"]),
      );
    });
  }
});

test("treats empty mjs import and re-export clauses as runtime edges", async (t) => {
  for (const [name, edge] of Object.entries({
    "empty import": 'import {} from "./index.mjs"; export const value = 1;\n',
    "empty re-export": 'export {} from "./index.mjs"; export const value = 1;\n',
  })) {
    await t.test(name, async () => {
      await withFixture(
        {
          "packages/a/src/index.mjs": 'import "./value.mjs"; export const root = 1;\n',
          "packages/a/src/value.mjs": edge,
        },
        async (result) => assert.deepEqual(categories(result), ["runtime import cycle"]),
        ["packages/a/src/**/*.mjs"],
        { exports: { ".": { import: "./dist/index.mjs" } } },
      );
    });
  }
});

test("rejects runtime cycles through aliased CommonJS loaders", async (t) => {
  const importers = {
    "called require": 'export const value = require.call(null, "./index.cjs");\n',
    "applied require": 'export const value = require.apply(null, ["./index.cjs"]);\n',
    "module require": 'export const value = module.require("./index.cjs");\n',
    "destructured module require": 'const { require: load } = module; export const value = load("./index.cjs");\n',
    "computed destructured module require":
      'const { ["require"]: load } = module; export const value = load("./index.cjs");\n',
    "aliased module require":
      'const runtimeModule = module; export const value = runtimeModule.require("./index.cjs");\n',
    "destructured aliased module require":
      'const runtimeModule = module; const { require: load } = runtimeModule; export const value = load("./index.cjs");\n',
    "require alias": 'const load = require; export const value = load("./index.cjs");\n',
    "bound require": 'const load = require.bind(null); export const value = load("./index.cjs");\n',
    "createRequire alias":
      'import { createRequire as makeRequire } from "node:module"; const load = makeRequire(import.meta.url); export const value = load("./index.cjs");\n',
    "destructured createRequire":
      'const { createRequire } = require("node:module"); const load = createRequire(__filename); export const value = load("./index.cjs");\n',
    "computed destructured createRequire":
      'const { ["createRequire"]: makeRequire } = require("node:module"); const load = makeRequire(__filename); export const value = load("./index.cjs");\n',
    "Module named import createRequire":
      'import { Module } from "node:module"; const load = Module.createRequire(import.meta.url); export const value = load("./index.cjs");\n',
    "destructured Module createRequire":
      'const { Module } = require("node:module"); const load = Module.createRequire(__filename); export const value = load("./index.cjs");\n',
    "namespace createRequire":
      'import * as moduleApi from "node:module"; const load = moduleApi.createRequire(import.meta.url); export const value = load("./index.cjs");\n',
    "CommonJS namespace createRequire":
      'const moduleApi = require("node:module"); const load = moduleApi.createRequire(__filename); export const value = load("./index.cjs");\n',
    "global require": 'export const value = globalThis.require("./index.cjs");\n',
    "self-referenced global require": 'export const value = globalThis.globalThis.require("./index.cjs");\n',
    "global module require": 'export const value = globalThis.module.require("./index.cjs");\n',
    "global process createRequire":
      'const load = globalThis.process.getBuiltinModule("node:module").createRequire(__filename); export const value = load("./index.cjs");\n',
    "TypeScript import equals Module":
      'import Module = require("node:module"); const load = Module.createRequire(__filename); export const value = load("./index.cjs");\n',
  };
  for (const [name, importer] of Object.entries(importers)) {
    await t.test(name, async () => {
      await withFixture(
        {
          "packages/a/src/index.cts": 'const load = require; export const root = load("./value.cjs");\n',
          "packages/a/src/value.cts": importer,
        },
        async (result) => assert.deepEqual(categories(result), ["runtime import cycle"]),
        ["packages/a/src/**/*.cts"],
        { exports: { ".": { require: "./dist/index.cjs" } } },
      );
    });
  }
});

test("rejects runtime cycles through runtime-acquired createRequire", async (t) => {
  const importers = {
    "destructured dynamic namespace":
      'const { createRequire } = await import("node:module"); const load = createRequire(import.meta.url); export const root = load("./value.mjs");\n',
    "dynamic namespace alias":
      'const moduleApi = await import("node:module"); const load = moduleApi.createRequire(import.meta.url); export const root = load("./value.mjs");\n',
    "immediate dynamic namespace access":
      'const load = (await import("node:module")).createRequire(import.meta.url); export const root = load("./value.mjs");\n',
    "process builtin module":
      'const load = process.getBuiltinModule("node:module").createRequire(import.meta.url); export const root = load("./value.mjs");\n',
    "aliased process builtin module":
      'const getBuiltin = process.getBuiltinModule; const moduleApi = getBuiltin("node:module"); const load = moduleApi.createRequire(import.meta.url); export const root = load("./value.mjs");\n',
    "destructured process builtin module":
      'const { getBuiltinModule } = process; const load = getBuiltinModule("node:module").createRequire(import.meta.url); export const root = load("./value.mjs");\n',
    "dynamic default Module":
      'const { default: Module } = await import("node:module"); const load = Module.createRequire(import.meta.url); export const root = load("./value.mjs");\n',
    "static named default Module":
      'import { default as Module } from "node:module"; const load = Module.createRequire(import.meta.url); export const root = load("./value.mjs");\n',
    "immediate dynamic default Module":
      'const load = (await import("node:module")).default.createRequire(import.meta.url); export const root = load("./value.mjs");\n',
  };
  for (const [name, importer] of Object.entries(importers)) {
    await t.test(name, async () => {
      await withFixture(
        {
          "packages/a/src/index.mts": importer,
          "packages/a/src/value.mts": 'import { root } from "./index.mjs"; export const value = root;\n',
        },
        async (result) => assert.deepEqual(categories(result), ["runtime import cycle"]),
        ["packages/a/src/**/*.mts"],
        { exports: { ".": { import: "./dist/index.mjs" } } },
      );
    });
  }
});

test("rejects bidirectional sibling modules loaded through require aliases", async () => {
  await withFixture(
    {
      "packages/a/src/left/item.cts": 'const load = require; export const left = load("../right/item.cjs");\n',
      "packages/a/src/right/item.cts": 'const load = require; export const right = load("../left/item.cjs");\n',
    },
    async (result) =>
      assert.deepEqual(categories(result), ["runtime import cycle", "bidirectional directory dependency"]),
    ["packages/a/src/**/*.cts"],
    {
      exports: {
        "./left/*": { require: "./dist/left/*.cjs" },
        "./right/*": { require: "./dist/right/*.cjs" },
      },
    },
  );
});

test("rejects non-static runtime module loads that cannot be placed in the graph", async () => {
  await withFixture(
    {
      "packages/a/src/index.cts":
        'const load = require; const target = "./value.cjs"; export const root = load(target);\n',
    },
    async (result) => assert.deepEqual(categories(result), ["non-static runtime module load"]),
    ["packages/a/src/**/*.cts"],
    { exports: { ".": { require: "./dist/index.cjs" } } },
  );
});

test("rejects computed dynamic imports and escaped CommonJS loaders", async (t) => {
  for (const [name, source] of Object.entries({
    "computed dynamic import": 'const target = "./value.js"; export const root = import(target);\n',
    "computed require call": 'const target = "./value.cjs"; export const root = require.call(null, target);\n',
    "computed require apply":
      'const parameters = ["./value.cjs"]; export const root = require.apply(null, parameters);\n',
    "exported require alias": "export const load = require;\n",
    "exported destructured createRequire": 'export const { createRequire } = require("node:module");\n',
    "exported destructured module require": "export const { require: load } = module;\n",
    "exported computed destructured module require": 'export const { ["require"]: load } = module;\n',
    "passed require alias":
      "declare function register(load: unknown): void; register(require); export const root = 1;\n",
    "passed CommonJS module alias":
      "declare function register(load: unknown): void; const runtimeModule = module; register(runtimeModule); export const root = 1;\n",
    "passed namespace createRequire":
      'import * as moduleApi from "node:module"; declare function register(load: unknown): void; register(moduleApi.createRequire); export const root = 1;\n',
    "unawaited dynamic module namespace":
      'import("node:module").then(({ createRequire }) => createRequire(import.meta.url)); export const root = 1;\n',
    "dynamic module namespace object rest":
      'const { ...moduleApi } = await import("node:module"); void moduleApi; export const root = 1;\n',
    "eval-based loader": 'const load = eval("require"); export const root = load("./value.cjs");\n',
    "Function-based loader": 'const load = Function("return require")(); export const root = load("./value.cjs");\n',
    "called Function loader":
      'const load = Function.call(null, "return require")(); export const root = load("./value.cjs");\n',
    "applied Function loader":
      'const load = Function.apply(null, ["return require"])(); export const root = load("./value.cjs");\n',
    "bound Function loader":
      'const Factory = Function.bind(null); const load = Factory("return require")(); export const root = load("./value.cjs");\n',
    "immediately bound Function loader":
      'const load = Function.bind(null)("return require")(); export const root = load("./value.cjs");\n',
    "function-constructor loader":
      'const load = (() => undefined).constructor("return require")(); export const root = load("./value.cjs");\n',
    "computed function-constructor loader":
      'const source = "return require"; const load = (() => undefined).constructor(source)(); export const root = load("./value.cjs");\n',
    "passed createRequire result":
      'import { createRequire } from "node:module"; declare function invoke(load: (specifier: string) => unknown): unknown; export const root = invoke(createRequire(import.meta.url));\n',
    "returned createRequire result":
      'import { createRequire } from "node:module"; function loader() { return createRequire(import.meta.url); } export const root = loader()("./value.cjs");\n',
    "internal Module loader":
      'import * as Module from "node:module"; const target = "./value.cjs"; export const root = Module._load(target);\n',
    "direct internal Module loader":
      'const target = "./value.cjs"; export const root = require("node:module")._load(target);\n',
    "destructured internal Module loader":
      'const { _load } = require("node:module"); const target = "./value.cjs"; export const root = _load(target);\n',
    "child Module loader": 'require("./holder.cjs"); export const root = module.children[0]!.require("./value.cjs");\n',
    "passed process loader capability":
      "declare function acquire(value: typeof process): unknown; export const root = acquire(process);\n",
    "passed global loader capability":
      "declare function acquire(value: typeof globalThis): unknown; export const root = acquire(globalThis);\n",
    "static namespace object rest":
      'import * as Module from "node:module"; const { ...copy } = Module; export const root = copy.createRequire(import.meta.url);\n',
    "computed module destructuring":
      'const member = "require"; const { [member]: load } = module; export const root = load("./value.cjs");\n',
    "computed global member": 'const member = "requ" + "ire"; export const root = globalThis[member]("./value.cjs");\n',
    "computed process member":
      'const member = "getBuiltin" + "Module"; export const root = process[member]("node:module");\n',
    "process object rest": 'const { ...copy } = process; export const root = copy.getBuiltinModule("node:module");\n',
    "global object rest": 'const { ...copy } = globalThis; export const root = copy.eval("require");\n',
    "cached child Module loader":
      'const target = require.resolve("./holder.cjs"); export const root = require.cache[target]!.require("./value.cjs");\n',
    "require main relative loader": 'export const root = require.main!.require("./value.cjs");\n',
    "module parent relative loader": 'export const root = module.parent!.require("./value.cjs");\n',
    "legacy process main module loader": 'export const root = process.mainModule!.require("./value.cjs");\n',
    "called Module require": 'export const root = module.require.call(module.parent, "./value.cjs");\n',
    "applied Module require": 'export const root = module.require.apply(module.parent, ["./value.cjs"]);\n',
    "bound Module require":
      'const load = module.require.bind(module.parent); export const root = load("./value.cjs");\n',
    "vm runInThisContext loader":
      'import { runInThisContext } from "node:vm"; const load = runInThisContext("require"); export const root = load("./value.cjs");\n',
    "vm compileFunction loader":
      'import { compileFunction } from "node:vm"; const load = compileFunction("return require")(); export const root = load("./value.cjs");\n',
    "vm Script loader":
      'import { Script } from "node:vm"; const load = new Script("require").runInThisContext(); export const root = load("./value.cjs");\n',
    "named module register hook":
      'import { register } from "node:module"; register("./hooks.mjs"); export const root = 1;\n',
    "named module registerHooks hook":
      'import { registerHooks } from "node:module"; registerHooks({}); export const root = 1;\n',
    "escaped arrow Function constructor":
      'const Factory = (() => {}).constructor; const load = Factory("return require")(); export const root = load("./value.cjs");\n',
    "destructured Function constructor":
      'const { constructor: Factory } = (() => {}); const load = Factory("return require")(); export const root = load("./value.cjs");\n',
    "Function prototype constructor":
      'const Factory = Function.prototype.constructor; const load = Factory("return require")(); export const root = load("./value.cjs");\n',
    "member Function constructor":
      'const Factory = Math.max.constructor; const load = Factory("return require")(); export const root = load("./value.cjs");\n',
    "computed alias Function constructor":
      'const memberName = "constructor"; const Factory = Math.max[memberName]; const load = Factory("return require")(); export const root = load("./value.cjs");\n',
    "reflected Function constructor":
      'const Factory = Reflect.get(Math.max, "constructor"); const load = Factory("return require")(); export const root = load("./value.cjs");\n',
    "descriptor Function constructor":
      'const Factory = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Math.max), "constructor")?.value; const load = Factory("return require")(); export const root = load("./value.cjs");\n',
    "process dlopen":
      "declare const target: string; process.dlopen({ exports: {} } as NodeModule, target); export const root = 1;\n",
    "process binding": 'export const root = process.binding("module_wrap");\n',
    "process linked binding": 'export const root = process._linkedBinding("module_wrap");\n',
  })) {
    await t.test(name, async () => {
      await withFixture({ "packages/a/src/index.ts": source }, async (result) =>
        assert.deepEqual(categories(result), ["non-static runtime module load"]),
      );
    });
  }
});

test("rejects createRequire bases that do not resolve relative to the importer", async (t) => {
  await t.test("shifted static base", async () => {
    await withFixture(
      {
        "packages/a/src/index.mts":
          'import { createRequire } from "node:module"; const load = createRequire(new URL("./nested/base.cjs", import.meta.url)); export const root = load("./value.cjs");\n',
        "packages/a/src/nested/value.cts": 'export const value = require("../index.mjs");\n',
      },
      async (result) => assert.deepEqual(categories(result), ["non-static runtime module load"]),
      ["packages/a/src/**/*.{cts,mts}"],
      {
        exports: {
          ".": { import: "./dist/index.mjs" },
          "./nested/value": { require: "./dist/nested/value.cjs" },
        },
      },
    );
  });
  await t.test("dynamic base", async () => {
    await withFixture(
      {
        "packages/a/src/index.mts":
          'import { createRequire } from "node:module"; const base = process.argv[2]; const load = createRequire(base); export const root = load("./value.cjs");\n',
      },
      async (result) => assert.deepEqual(categories(result), ["non-static runtime module load"]),
      ["packages/a/src/**/*.mts"],
      { exports: { ".": { import: "./dist/index.mjs" } } },
    );
  });
});

test("rejects recursive JavaScript entry loaders outside the static module graph", async (t) => {
  for (const [name, source] of Object.entries({
    Worker:
      'import { Worker } from "node:worker_threads"; new Worker(new URL("./right.js", import.meta.url)); export const left = 1;\n',
    fork: 'import { fork } from "node:child_process"; fork("./right.js"); export const left = 1;\n',
  })) {
    await t.test(name, async () => {
      await withFixture(
        {
          "packages/a/src/index.ts": 'export { left } from "./left.js"; export { right } from "./right.js";\n',
          "packages/a/src/left.ts": source,
          "packages/a/src/right.ts": 'import { left } from "./left.js"; export const right = left;\n',
        },
        async (result) => assert.deepEqual(categories(result), ["non-static runtime module load"]),
      );
    });
  }
});

test("allows createRequire resolve without treating the resolver as a loader escape", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts":
        'import { createRequire } from "node:module"; export const path = createRequire(import.meta.url).resolve("typescript");\n',
    },
    async (result) => assert.deepEqual(result.diagnostics, []),
    undefined,
    { dependencies: { typescript: "^5.0.0" } },
  );
});

test("counts createRequire resolve as a production package dependency", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts":
        'import { createRequire } from "node:module"; export const path = createRequire(import.meta.url).resolve("undeclared-tool/cli");\n',
    },
    async (result) => assert.deepEqual(categories(result), ["undeclared production dependency"]),
  );
});

test("counts an aliased require resolver as a production package dependency", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts":
        'const resolvePackage = require.resolve; export const path = resolvePackage("undeclared-tool/cli");\n',
    },
    async (result) => assert.deepEqual(categories(result), ["undeclared production dependency"]),
  );
});

test("counts a required peer of an imported package as a production dependency", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts": 'import "render-kit"; export const ready = true;\n',
      "node_modules/render-kit/package.json": JSON.stringify({
        name: "render-kit",
        peerDependencies: { "native-canvas": "^1.0.0" },
      }),
    },
    async (result) => assert.deepEqual(result.diagnostics, []),
    undefined,
    { dependencies: { "native-canvas": "^1.0.0", "render-kit": "^1.0.0" } },
  );
});

test("does not count an optional peer as a production dependency", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts": 'import "render-kit"; export const ready = true;\n',
      "node_modules/render-kit/package.json": JSON.stringify({
        name: "render-kit",
        peerDependencies: { "optional-adapter": "^1.0.0" },
        peerDependenciesMeta: { "optional-adapter": { optional: true } },
      }),
    },
    async (result) => assert.deepEqual(categories(result), ["unused package dependency"]),
    undefined,
    { dependencies: { "optional-adapter": "^1.0.0", "render-kit": "^1.0.0" } },
  );
});

test("counts import.meta resolve as a production package dependency", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts": 'export const path = import.meta.resolve("undeclared-tool/cli");\n',
    },
    async (result) => assert.deepEqual(categories(result), ["undeclared production dependency"]),
  );
});

test("resolves conditional exports according to the loader syntax", async () => {
  await withFixture(
    {
      "packages/a/src/a.cts": 'export const a = require("@fixture/a/b");\n',
      "packages/a/src/b.cts": 'export const b = require("@fixture/a/a");\n',
      "packages/a/src/unused-a.mts": "export const unusedA = 1;\n",
      "packages/a/src/unused-b.mts": "export const unusedB = 1;\n",
    },
    async (result) => assert.deepEqual(categories(result), ["runtime import cycle"]),
    ["packages/a/src/**/*.{cts,mts}"],
    {
      exports: {
        "./a": { import: "./dist/unused-a.mjs", require: "./dist/a.cjs" },
        "./b": { import: "./dist/unused-b.mjs", require: "./dist/b.cjs" },
      },
    },
  );
});

test("preserves the importer module mode while resolving type-only conditional exports", async () => {
  await withFixture(
    {
      "packages/a/src/index.mts": 'import type { Value } from "@fixture/a/value"; export type Root = Value;\n',
      "packages/a/src/right/value.mts": "export type Value = { right: true };\n",
      "packages/a/src/unused/value.cts": "export type Value = { unused: true };\n",
    },
    async (result) => assert.deepEqual(result.diagnostics, []),
    ["packages/a/src/**/*.{cts,mts}"],
    {
      exports: {
        ".": { import: "./dist/index.mjs" },
        "./value": { require: "./dist/unused/value.cjs", import: "./dist/right/value.mjs" },
        "./unused": { require: "./dist/unused/value.cjs" },
      },
    },
  );
});

test("maps relative mjs and cjs specifiers only to their matching source formats", async (t) => {
  for (const format of [
    { emitted: "mjs", source: "mts", condition: "import" },
    { emitted: "cjs", source: "cts", condition: "require" },
  ]) {
    await t.test(format.source, async () => {
      await withFixture(
        {
          [`packages/a/src/index.${format.source}`]: `import { value } from "./value.${format.emitted}"; export const root = value;\n`,
          [`packages/a/src/value.${format.source}`]: `import { root } from "./index.${format.emitted}"; export const value = root;\n`,
          "packages/a/src/value.ts": "export const shadow = 1;\n",
        },
        async (result) => assert.deepEqual(categories(result), ["runtime import cycle"]),
        [`packages/a/src/**/*.${format.source}`, "packages/a/src/**/*.ts"],
        {
          exports: {
            ".": { [format.condition]: `./dist/index.${format.emitted}` },
            "./value": { [format.condition]: `./dist/value.${format.emitted}` },
            "./shadow": { import: "./dist/value.js" },
          },
        },
      );
    });
  }
});

test("resolves package imports through the importing workspace manifest", async () => {
  await withFixture(
    {
      "packages/a/src/index.mts": 'import { value } from "#value"; export const root = value;\n',
      "packages/a/src/value.mts": 'import { root } from "./index.mjs"; export const value = root;\n',
    },
    async (result) => assert.deepEqual(categories(result), ["runtime import cycle"]),
    ["packages/a/src/**/*.mts"],
    {
      exports: { ".": { import: "./dist/index.mjs" } },
      imports: { "#value": { node: { import: "./dist/value.mjs" } } },
    },
  );
});

test("resolves nested conditions and export fallback arrays", async (t) => {
  const exportPairs = {
    "nested node conditions": {
      "./a": { node: { import: "./dist/a.mjs" }, default: "./dist/unused-a.mjs" },
      "./b": { node: { import: "./dist/b.mjs" }, default: "./dist/unused-b.mjs" },
    },
    "fallback arrays": {
      "./a": ["./dist/a.mjs", "./dist/unused-a.mjs"],
      "./b": ["./dist/b.mjs", "./dist/unused-b.mjs"],
    },
  };
  for (const [name, exports] of Object.entries(exportPairs)) {
    await t.test(name, async () => {
      await withFixture(
        {
          "packages/a/src/a.mts": 'import { b } from "@fixture/a/b"; export const a = b;\n',
          "packages/a/src/b.mts": 'import { a } from "@fixture/a/a"; export const b = a;\n',
          "packages/a/src/unused-a.mts": "export const unusedA = 1;\n",
          "packages/a/src/unused-b.mts": "export const unusedB = 1;\n",
        },
        async (result) => assert.deepEqual(categories(result), ["runtime import cycle"]),
        ["packages/a/src/**/*.mts"],
        { exports },
      );
    });
  }
});

test("rejects a workspace export with no active runtime condition", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts": 'import { value } from "@fixture/a/value"; export const root = value;\n',
      "packages/a/src/value.ts": "export const value = 1;\n",
    },
    async (result) => assert.deepEqual(categories(result), ["unresolved workspace import"]),
    undefined,
    {
      exports: {
        ".": { import: "./dist/index.js" },
        "./value": { browser: "./dist/value.js" },
      },
    },
  );
});

test("resolves reciprocal workspace imports through main entries", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts": 'import { value as other } from "@fixture/b"; export const value = other;\n',
      "packages/b/src/index.ts": 'import { value as other } from "@fixture/a"; export const value = other;\n',
    },
    async (result) =>
      assert.deepEqual(categories(result), ["runtime import cycle", "bidirectional directory dependency"]),
    undefined,
    { dependencies: { "@fixture/b": "file:../b" }, exports: undefined, main: "./dist/index.js" },
    { dependencies: { "@fixture/a": "file:../a" }, exports: undefined, main: "./dist/index.js" },
  );
});

test("resolves reciprocal workspace imports through top-level export forms", async (t) => {
  const exportForms = {
    "string exports": "./dist/index.js",
    "conditional main exports": { import: "./dist/index.js", require: "./dist/index.cjs" },
  };
  for (const [name, exports] of Object.entries(exportForms)) {
    await t.test(name, async () => {
      await withFixture(
        {
          "packages/a/src/index.ts": 'import { value as other } from "@fixture/b"; export const value = other;\n',
          "packages/b/src/index.ts": 'import { value as other } from "@fixture/a"; export const value = other;\n',
          ...(typeof exports === "object"
            ? {
                "packages/a/src/index.cts": "export const commonJsA = 1;\n",
                "packages/b/src/index.cts": "export const commonJsB = 1;\n",
              }
            : {}),
        },
        async (result) =>
          assert.deepEqual(categories(result), ["runtime import cycle", "bidirectional directory dependency"]),
        typeof exports === "object"
          ? ["packages/*/src/**/*.ts", "packages/*/src/**/*.cts"]
          : ["packages/*/src/**/*.ts"],
        { dependencies: { "@fixture/b": "file:../b" }, exports },
        { dependencies: { "@fixture/a": "file:../a" }, exports },
      );
    });
  }
});

test("does not classify a type-only self edge as a runtime cycle", async () => {
  await withFixture({ "packages/a/src/index.ts": 'export type Self = import("./index.js").Self;\n' }, async (result) =>
    assert.deepEqual(result.diagnostics, []),
  );
});

test("rejects bidirectional sibling directory modules", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts":
        'export type { Left } from "./left/item.js"; export type { Right } from "./right/item.js";\n',
      "packages/a/src/left/item.ts":
        'import type { Right } from "../right/item.js"; export type Left = { right: Right };\n',
      "packages/a/src/right/item.ts":
        'import type { Left } from "../left/item.js"; export type Right = { left: Left };\n',
    },
    async (result) => assert.deepEqual(categories(result), ["bidirectional directory dependency"]),
  );
});

test("rejects bidirectional apex and descendant directory modules", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts": 'import type { Child } from "./child/item.js"; export type Root = { child: Child };\n',
      "packages/a/src/child/item.ts": 'import type { Root } from "../index.js"; export type Child = { root: Root };\n',
    },
    async (result) => assert.deepEqual(categories(result), ["bidirectional directory dependency"]),
  );
});

test("rejects bidirectional parent and nested directory modules", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts": 'export type { Parent } from "./domain/index.js";\n',
      "packages/a/src/domain/index.ts":
        'import type { Child } from "./child/item.js"; export type Parent = { child: Child };\n',
      "packages/a/src/domain/child/item.ts":
        'import type { Parent } from "../index.js"; export type Child = { parent: Parent };\n',
    },
    async (result) => assert.deepEqual(categories(result), ["bidirectional directory dependency"]),
  );
});

test("allows bidirectional type dependencies inside one directory module", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts": 'import type { Peer } from "./peer.js"; export type Root = { peer: Peer };\n',
      "packages/a/src/peer.ts": 'import type { Root } from "./index.js"; export type Peer = { root: Root };\n',
    },
    async (result) => assert.deepEqual(result.diagnostics, []),
  );
});

test("rejects unreachable production source", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts": "export const root = 1;\n",
      "packages/a/src/orphan.ts": "export const orphan = 1;\n",
    },
    async (result) => assert.deepEqual(categories(result), ["production source unreachable from a package entry"]),
  );
});

test("rejects runtime cycles in generated production source", async () => {
  await withFixture(
    {
      "packages/a/src/gen/a.ts": 'import { b } from "./b.js"; export const a = b;\n',
      "packages/a/src/gen/b.ts": 'import { a } from "./a.js"; export const b = a;\n',
      "packages/a/src/index.ts": 'export { a } from "./gen/a.js";\n',
    },
    async (result) => assert.deepEqual(categories(result), ["runtime import cycle"]),
  );
});

test("rejects unreachable generated production source", async () => {
  await withFixture(
    {
      "packages/a/src/gen/orphan.ts": "export const orphan = 1;\n",
      "packages/a/src/index.ts": "export const root = 1;\n",
    },
    async (result) => assert.deepEqual(categories(result), ["production source unreachable from a package entry"]),
  );
});

test("rejects exact and glob architecture selectors without a live source", async () => {
  await withFixture(
    { "packages/a/src/index.ts": "export const root = 1;\n" },
    async (result) => {
      assert.deepEqual(categories(result), ["stale architecture-rule path"]);
      assert.deepEqual(result.diagnostics[0].details, ["packages/a/src/ghost.ts", "packages/a/src/missing/**/*.ts"]);
    },
    ["packages/a/src/ghost.ts", "packages/a/src/missing/**/*.ts"],
  );
});

test("rejects each stale arm of a partially live brace selector", async () => {
  await withFixture(
    { "packages/a/src/index.ts": "export const root = 1;\n" },
    async (result) => {
      assert.deepEqual(categories(result), ["stale architecture-rule path"]);
      assert.deepEqual(result.diagnostics[0].details, ["packages/b/src/**/*.ts", "packages/c/src/**/*.ts"]);
    },
    ["packages/{a,b,c}/src/**/*.ts"],
  );
});

test("rejects a stale anchored selector outside workspace source trees", async () => {
  await withFixture(
    { "packages/a/src/index.ts": "export const root = 1;\n" },
    async (result) => {
      assert.deepEqual(categories(result), ["stale architecture-rule path"]);
      assert.deepEqual(result.diagnostics[0].details, ["scripts/missing/**/*.mjs"]);
    },
    ["scripts/missing/**/*.mjs"],
  );
});

test("matches anchored selectors against non-TypeScript repository files", async () => {
  await withFixture(
    {
      "packages/a/assets/schema.json": "{}\n",
      "packages/a/src/index.ts": "export const root = 1;\n",
    },
    async (result) => assert.deepEqual(result.diagnostics, []),
    ["packages/a/assets/**/*.json"],
  );
});

test("rejects a stale restricted-import path group", async () => {
  await withFixture(
    { "packages/a/src/index.ts": "export const root = 1;\n" },
    async (result) => {
      assert.deepEqual(categories(result), ["stale architecture-rule path"]);
      assert.deepEqual(result.diagnostics[0].details, ["**/removed-module/**"]);
    },
    ["packages/*/src/**/*.ts"],
    {},
    {},
    {
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/removed-module/**"] }] }],
    },
  );
});

test("rejects stale restricted-import regex paths", async () => {
  await withFixture(
    {
      "packages/a/src/consumer.ts": "export const consumer = 1;\n",
      "packages/a/src/index.ts": 'export { consumer } from "./consumer.js"; export { live } from "./live.js";\n',
      "packages/a/src/live.ts": "export const live = 1;\n",
    },
    async (result) => {
      assert.deepEqual(categories(result), ["stale architecture-rule path"]);
      assert.deepEqual(result.diagnostics[0].details, ["^\\./removed-module\\.js$"]);
    },
    ["packages/a/src/consumer.ts"],
    {},
    {},
    {
      "no-restricted-imports": ["error", { patterns: [{ regex: "^\\./(?:live|removed-module)\\.js$" }] }],
    },
  );
});

test("rejects a production dependency used only by tests", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts": "export const root = 1;\n",
      "packages/a/tests/integration.test.ts": 'import { value } from "@fixture/b"; void value;\n',
      "packages/b/src/index.ts": "export const value = 1;\n",
    },
    async (result) => assert.deepEqual(categories(result), ["package dependency used only by tests"]),
    undefined,
    { dependencies: { "@fixture/b": "file:../b" } },
  );
});

test("rejects an undeclared production dependency", async () => {
  await withFixture(
    {
      "packages/a/src/index.ts": 'import { value } from "@fixture/b"; export const root = value;\n',
      "packages/b/src/index.ts": "export const value = 1;\n",
    },
    async (result) => assert.deepEqual(categories(result), ["undeclared production dependency"]),
  );
});

test("counts generated production imports as dependency consumers", async () => {
  await withFixture(
    {
      "packages/a/src/gen/client.ts": 'import { value } from "@fixture/b"; export const generated = value;\n',
      "packages/a/src/index.ts": 'export { generated } from "./gen/client.js";\n',
      "packages/b/src/index.ts": "export const value = 1;\n",
    },
    async (result) => assert.deepEqual(result.diagnostics, []),
    undefined,
    { dependencies: { "@fixture/b": "file:../b" } },
  );
});

test("treats generated wildcard exports as package entry roots", async () => {
  await withFixture(
    { "packages/a/src/dto-gen/value.ts": "export const value = 1;\n" },
    async (result) => assert.deepEqual(result.diagnostics, []),
    ["packages/a/src/**/*.ts"],
    { exports: { "./dto/*": { import: "./dist/dto-gen/*.js" } } },
  );
});

test("expands wildcard exports and accepts mjs entries", async () => {
  await withFixture(
    { "packages/a/src/feature.mjs": "export const feature = 1;\n" },
    async (result) => assert.deepEqual(result.diagnostics, []),
    ["packages/a/src/**/*.mjs"],
    { exports: { "./*": { import: "./dist/*.mjs" } } },
  );
});

test("enforces Engine layer restrictions with concrete import patterns", async (t) => {
  const cases = [
    {
      name: "activation cannot import reconciliation",
      filePath: "packages/engine/src/domain/activation/activation-perspective.ts",
      source: 'import "../reconcile/index.js";\n',
    },
    {
      name: "persistence cannot import workspace",
      filePath: "packages/engine/src/subsystems/persistence/scoped-document-store.ts",
      source: 'import "../workspace/index.js";\n',
    },
    {
      name: "authority cannot import reconciliation",
      filePath: "packages/engine/src/subsystems/workspace/authority/fact-authority.ts",
      source: 'import "../../../domain/reconcile/index.js";\n',
    },
    {
      name: "application cannot import authority internals",
      filePath: "packages/engine/src/subsystems/workspace/application/result-mapping.ts",
      source: 'import "../authority/errors.js";\n',
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      assert.ok((await lintRuleIds(fixture.source, fixture.filePath)).includes("no-restricted-imports"));
    });
  }
});

test("enforces one-way Engine platform package dependencies", async (t) => {
  const cases = [
    {
      name: "core cannot import desktop",
      filePath: "packages/engine/src/index.ts",
      source: 'import "@lode/engine-platform-desktop";\n',
    },
    {
      name: "mobile cannot import Node builtins",
      filePath: "packages/engine-platform-mobile/src/index.ts",
      source: 'import "node:fs";\n',
    },
    {
      name: "mobile cannot import desktop",
      filePath: "packages/engine-platform-mobile/src/index.ts",
      source: 'import "@lode/engine-platform-desktop";\n',
    },
    {
      name: "desktop cannot import mobile",
      filePath: "packages/engine-platform-desktop/src/index.ts",
      source: 'import "@lode/engine-platform-mobile";\n',
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      assert.ok(
        (await lintRuleIds(fixture.source, fixture.filePath)).includes("architecture/engine-platform-direction"),
      );
    });
  }
});

test("enforces the CLI product boundary after specialized configs are merged", async () => {
  const filePath = "apps/cli/src/families/field.ts";
  assert.ok((await lintRuleIds('import "@lode/engine";\n', filePath)).includes("architecture/cli-product-boundary"));
  assert.ok((await lintRuleIds('import "@lode/daemon";\n', filePath)).includes("architecture/cli-product-boundary"));
  assert.ok(
    !(await lintRuleIds('import "@lode/daemon";\n', "apps/cli/src/bin/lode-daemon.ts")).includes(
      "architecture/cli-product-boundary",
    ),
  );
});

test("enforces the desktop renderer, host, daemon, and mobile boundaries", async (t) => {
  const cases = [
    {
      name: "renderer cannot import Node",
      filePath: "apps/desktop/src/renderer.tsx",
      source: 'import "node:fs";\n',
    },
    {
      name: "renderer cannot dial the desktop transport",
      filePath: "apps/desktop/src/renderer.tsx",
      source: 'import "@lode/desktop-client";\n',
    },
    {
      name: "preload cannot dial the desktop transport",
      filePath: "apps/desktop/src/preload.cts",
      source: 'import "@lode/desktop-client";\n',
    },
    {
      name: "host cannot compose Engine",
      filePath: "apps/desktop/src/host/desktop-host.ts",
      source: 'import "@lode/engine-platform-desktop";\n',
    },
    {
      name: "desktop cannot import mobile",
      filePath: "apps/desktop/src/main.ts",
      source: 'import "@lode/engine-platform-mobile";\n',
    },
    {
      name: "only daemon entry imports daemon",
      filePath: "apps/desktop/src/host/desktop-host.ts",
      source: 'import "@lode/daemon";\n',
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      assert.ok(
        (await lintRuleIds(fixture.source, fixture.filePath)).includes("architecture/desktop-product-boundary"),
      );
    });
  }
  assert.ok(
    !(await lintRuleIds('import "@lode/daemon";\n', "apps/desktop/src/daemon.ts")).includes(
      "architecture/desktop-product-boundary",
    ),
  );
});

test("enforces the design system boundaries", async (t) => {
  const cases = [
    {
      name: "application screens cannot carry raw color literals",
      filePath: "packages/application/src/shell/lode-app.tsx",
      source: 'export const bad = <div className="bg-white text-[#1A2B3C]" />;\n',
      ruleId: "design/no-raw-visual-values",
    },
    {
      name: "application screens cannot use arbitrary values for token-owned utilities",
      filePath: "packages/application/src/shell/lode-app.tsx",
      source: 'export const bad = <div className="p-[13px]" />;\n',
      ruleId: "design/no-raw-visual-values",
    },
    {
      name: "application screens render controls through the ui layer",
      filePath: "packages/application/src/shell/lode-app.tsx",
      source: 'export const bad = <button type="button">Save</button>;\n',
      ruleId: "design/product-through-components",
    },
    {
      name: "mobile screens render controls through the ui layer",
      filePath: "apps/mobile/src/App.tsx",
      source: 'export const bad = <button type="button">Save</button>;\n',
      ruleId: "design/product-through-components",
    },
    {
      name: "mobile screens cannot use arbitrary values for token-owned utilities",
      filePath: "apps/mobile/src/App.tsx",
      source: 'export const bad = <div className="p-[13px]" />;\n',
      ruleId: "design/no-raw-visual-values",
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      assert.ok((await lintRuleIds(fixture.source, fixture.filePath)).includes(fixture.ruleId));
    });
  }
  await t.test("the shared web ui stays host-neutral", async () => {
    const ids = await lintRuleIds('import "electron";\n', "packages/ui/src/index.ts");
    assert.ok(ids.includes("architecture/ui-host-neutral"));
  });
});

test("keeps mobile Engine work inside the dedicated Worker", async () => {
  const uiIds = await lintRuleIds('import "@lode/engine";\n', "apps/mobile/src/App.tsx");
  assert.ok(uiIds.includes("no-restricted-imports"));

  const workerIds = await lintRuleIds('import "@lode/engine";\n', "apps/mobile/src/engine-worker/index.ts");
  assert.ok(!workerIds.includes("no-restricted-imports"));
});

async function lintRuleIds(source, filePath) {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.map((message) => message.ruleId);
}

async function withFixture(
  files,
  check,
  lintFiles = ["packages/a/src/**/*.ts"],
  packageA = {},
  packageB = {},
  rules = undefined,
) {
  const root = await mkdtemp(join(tmpdir(), "lode-architecture-"));
  try {
    const packages = Object.keys(files).some((path) => path.startsWith("packages/b/")) ? ["a", "b"] : ["a"];
    await write(root, "package.json", JSON.stringify({ private: true, workspaces: ["packages/*"] }));
    await write(
      root,
      "eslint.config.mjs",
      `export default ${JSON.stringify([{ files: lintFiles, ...(rules === undefined ? {} : { rules }) }])};\n`,
    );
    for (const name of packages) {
      const additions = name === "a" ? packageA : packageB;
      const manifest = {
        name: `@fixture/${name}`,
        type: "module",
        exports: { ".": { import: "./dist/index.js" } },
        ...additions,
      };
      await write(root, `packages/${name}/package.json`, JSON.stringify(manifest));
    }
    for (const [path, content] of Object.entries(files)) {
      await write(root, path, content);
    }
    await check(await analyzeRepositoryArchitecture(root));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function write(root, path, content) {
  const destination = join(root, path);
  await mkdir(join(destination, ".."), { recursive: true });
  await writeFile(destination, content, "utf8");
}

function categories(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.category);
}
