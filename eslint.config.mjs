import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import nodeImport from "eslint-plugin-node-import";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";
import { basename, dirname, resolve } from "node:path";

function moduleSource(node) {
  const source = node.source ?? node.argument ?? node.parameter;
  if (typeof source?.value === "string") {
    return source.value;
  }
  if (source?.type === "TemplateLiteral" && source.expressions.length === 0) {
    return source.quasis[0]?.value.cooked ?? source.quasis[0]?.value.raw;
  }
  return undefined;
}

function moduleVisitors(check) {
  return {
    ImportDeclaration: check,
    ExportNamedDeclaration: check,
    ExportAllDeclaration: check,
    ImportExpression: check,
    TSImportType: check,
  };
}

function normalizedModule(context, source) {
  return source.startsWith(".") ? resolve(dirname(context.filename), source).replaceAll("\\", "/") : source;
}

const architecturePlugin = {
  rules: {
    "engine-owner-location": {
      meta: { type: "problem", schema: [], messages: { restricted: "{{message}}" } },
      create(context) {
        return {
          Program(node) {
            const filename = context.filename.replaceAll("\\", "/");
            const engineSource = "/packages/engine/src/";
            const sourceIndex = filename.toLowerCase().indexOf(engineSource);
            if (sourceIndex < 0) {
              return;
            }
            const relative = filename.slice(sourceIndex + engineSource.length);
            const topLevel = relative.split("/")[0];
            const allowed = new Set(["crypto", "decoding", "domain", "subsystems", "engine.ts", "index.ts"]);
            if (!allowed.has(topLevel)) {
              context.report({
                node,
                messageId: "restricted",
                data: {
                  message:
                    "Engine source lives in an apex file, the pure domain, a neutral technical leaf, or its owning subsystem.",
                },
              });
            }
          },
        };
      },
    },
    "engine-platform-direction": {
      meta: { type: "problem", schema: [], messages: { restricted: "{{message}}" } },
      create(context) {
        const filename = context.filename.replaceAll("\\", "/");
        if (filename.endsWith(".test.ts") || filename.includes("/tests/")) {
          return {};
        }
        return moduleVisitors((node) => {
          const source = moduleSource(node);
          if (!source) {
            return;
          }
          const insideEngine = filename.includes("/packages/engine/src/");
          const insideMobile = filename.includes("/packages/engine-platform-mobile/src/");
          const insideDesktop = filename.includes("/packages/engine-platform-desktop/src/");
          if (
            insideEngine &&
            (source === "@lode/engine-platform-desktop" || source === "@lode/engine-platform-mobile")
          ) {
            context.report({
              node,
              messageId: "restricted",
              data: { message: "Shared Engine code cannot depend on a platform implementation." },
            });
            return;
          }
          if (
            insideMobile &&
            (source.startsWith("node:") || source === "better-sqlite3" || source === "@lode/engine-platform-desktop")
          ) {
            context.report({
              node,
              messageId: "restricted",
              data: { message: "The mobile platform cannot depend on desktop or Node-only modules." },
            });
          }
          if (insideDesktop && source === "@lode/engine-platform-mobile") {
            context.report({
              node,
              messageId: "restricted",
              data: { message: "The desktop platform cannot depend on the mobile platform." },
            });
          }
        });
      },
    },
    "engine-transport-neutral": {
      meta: { type: "problem", schema: [], messages: { restricted: "{{message}}" } },
      create(context) {
        return moduleVisitors((node) => {
          const source = moduleSource(node);
          if (
            typeof source === "string" &&
            (source === "@lode/protocol" ||
              source.startsWith("@lode/protocol/") ||
              source === "@lode/desktop-client" ||
              source.startsWith("@lode/desktop-client/") ||
              source.startsWith("@bufbuild/"))
          ) {
            context.report({
              node,
              messageId: "restricted",
              data: { message: "Engine contracts and domain code are transport-neutral." },
            });
          }
        });
      },
    },
    "engine-composition": {
      meta: { type: "problem", schema: [], messages: { restricted: "{{message}}" } },
      create(context) {
        const filename = context.filename.replaceAll("\\", "/");
        return moduleVisitors((node) => {
          const source = moduleSource(node);
          if (!source) {
            return;
          }
          const target = normalizedModule(context, source);
          const importsCollection = /\/subsystems\/(?:index|collection)\.js$/.test(target);
          const importsDefinition = /\/subsystems\/[^/]+\/[^/]+-subsystem\.js$/.test(target);
          const importsLifecyclePrimitive = /\/subsystems\/(?:definition|subsystem)\.js$/.test(target);
          const insideSubsystem = filename.includes("/packages/engine/src/subsystems/");
          if (importsCollection || importsDefinition || (importsLifecyclePrimitive && !insideSubsystem)) {
            context.report({
              node,
              messageId: "restricted",
              data: {
                message:
                  "Engine subsystem collection composition belongs to engine.ts; subsystem definitions own only their lifecycle definition and declared seams.",
              },
            });
          }
        });
      },
    },
    "subsystem-dependencies": {
      meta: {
        type: "problem",
        schema: [{ type: "object", properties: { owner: { type: "string" }, forbidden: { type: "array" } } }],
        messages: {
          restricted: "The {{owner}} subsystem can depend only in the declared Engine subsystem graph direction.",
        },
      },
      create(context) {
        const { owner = "unknown", forbidden = [] } = context.options[0] ?? {};
        const forbiddenOwners = new Set(forbidden);
        return moduleVisitors((node) => {
          const source = moduleSource(node);
          if (!source) {
            return;
          }
          const dependency = /\/subsystems\/([^/]+)(?:\/|\.js$)/.exec(normalizedModule(context, source))?.[1];
          if (dependency && forbiddenOwners.has(dependency)) {
            context.report({ node, messageId: "restricted", data: { owner } });
          }
        });
      },
    },
    "persistence-seam": {
      meta: { type: "problem", schema: [], messages: { restricted: "{{message}}" } },
      create(context) {
        return moduleVisitors((node) => {
          const source = moduleSource(node);
          if (!source) {
            return;
          }
          const target = normalizedModule(context, source);
          if (/\/subsystems\/persistence\/(?!index\.js$).+/.test(target)) {
            context.report({
              node,
              messageId: "restricted",
              data: { message: "Persistence is consumed through its public subsystem seam." },
            });
          }
        });
      },
    },
    "daemon-peer-ports": {
      meta: { type: "problem", schema: [], messages: { restricted: "{{message}}" } },
      create(context) {
        const allowed = new Set([
          "PeerTransportPort",
          "ReplicaExchangeHandler",
          "ReplicaExchangeProof",
          "ReplicaExchangeWire",
        ]);
        return moduleVisitors((node) => {
          const source = moduleSource(node);
          if (typeof source !== "string" || !source.startsWith("@lode/engine")) {
            return;
          }
          const valid =
            node.type === "ImportDeclaration" &&
            source === "@lode/engine" &&
            node.importKind === "type" &&
            node.specifiers.every(
              (specifier) => specifier.type === "ImportSpecifier" && allowed.has(specifier.imported.name),
            );
          if (!valid) {
            context.report({
              node,
              messageId: "restricted",
              data: {
                message:
                  "Daemon Peer adapters import only named Engine-owned Peer Transport port types from @lode/engine.",
              },
            });
          }
        });
      },
    },
    "cli-family-dependencies": {
      meta: { type: "problem", schema: [], messages: { restricted: "{{message}}" } },
      create(context) {
        const filename = context.filename.replaceAll("\\", "/");
        if (!filename.includes("/apps/cli/src/families/")) {
          return {};
        }
        const owner = basename(filename, ".ts").split("-")[0];
        return moduleVisitors((node) => {
          const source = moduleSource(node);
          if (typeof source !== "string" || !source.startsWith("./")) {
            return;
          }
          const dependency = /\/families\/([^/]+)\.js$/.exec(normalizedModule(context, source))?.[1];
          if (dependency !== undefined && dependency.split("-")[0] !== owner) {
            context.report({
              node,
              messageId: "restricted",
              data: {
                message:
                  "A CLI command family cannot import another family; shared command construction belongs below families.",
              },
            });
          }
        });
      },
    },
    "cli-product-boundary": {
      meta: { type: "problem", schema: [], messages: { restricted: "{{message}}" } },
      create(context) {
        const filename = context.filename.replaceAll("\\", "/");
        const daemonEntry = filename.endsWith("/apps/cli/src/bin/lode-daemon.ts");
        return moduleVisitors((node) => {
          const source = moduleSource(node);
          if (typeof source !== "string") {
            return;
          }
          const importsEngine = source === "@lode/engine" || source.startsWith("@lode/engine/");
          const importsDaemon = source === "@lode/daemon" || source.startsWith("@lode/daemon/");
          if (importsEngine || (importsDaemon && !daemonEntry)) {
            context.report({
              node,
              messageId: "restricted",
              data: {
                message:
                  "Desktop commands reach product behavior through @lode/sdk and @lode/desktop-client; only the daemon binary entry owns @lode/daemon.",
              },
            });
          }
        });
      },
    },
    "desktop-product-boundary": {
      meta: { type: "problem", schema: [], messages: { restricted: "{{message}}" } },
      create(context) {
        const filename = context.filename.replaceAll("\\", "/");
        const renderer =
          filename.endsWith("/apps/desktop/src/renderer.tsx") || filename.includes("/apps/desktop/src/renderer/");
        const preload = filename.endsWith("/apps/desktop/src/preload.cts");
        const daemonEntry = filename.endsWith("/apps/desktop/src/daemon.ts");
        return moduleVisitors((node) => {
          const source = moduleSource(node);
          if (typeof source !== "string") {
            return;
          }
          const mobile =
            source === "@lode/engine-platform-mobile" ||
            source === "@lode/app-mobile" ||
            source === "react-native" ||
            source.startsWith("react-native/");
          const engine =
            source === "@lode/engine" ||
            source.startsWith("@lode/engine/") ||
            source === "@lode/engine-platform-desktop" ||
            source === "better-sqlite3";
          const daemon = source === "@lode/daemon" || source.startsWith("@lode/daemon/");
          const transport = source === "@lode/desktop-client" || source.startsWith("@lode/desktop-client/");
          const hostCapability = source === "electron" || source.startsWith("node:");
          if (mobile) {
            context.report({
              node,
              messageId: "restricted",
              data: { message: "Desktop production code cannot depend on mobile packages or React Native." },
            });
            return;
          }
          if (renderer && (engine || daemon || transport || hostCapability)) {
            context.report({
              node,
              messageId: "restricted",
              data: {
                message: "The desktop renderer is pure UI and receives product capabilities only through preload.",
              },
            });
            return;
          }
          if (preload && (engine || daemon || transport || source.startsWith("node:"))) {
            context.report({
              node,
              messageId: "restricted",
              data: { message: "The desktop preload owns only its narrow contextBridge adapter." },
            });
            return;
          }
          if (!renderer && !preload && (engine || (daemon && !daemonEntry))) {
            context.report({
              node,
              messageId: "restricted",
              data: {
                message:
                  "The desktop host reaches product behavior through @lode/desktop-client; only its daemon entry imports @lode/daemon.",
              },
            });
          }
        });
      },
    },
    "ui-host-neutral": {
      meta: { type: "problem", schema: [], messages: { restricted: "{{message}}" } },
      create(context) {
        return moduleVisitors((node) => {
          const source = moduleSource(node);
          if (typeof source !== "string") {
            return;
          }
          const hostOwned =
            source.startsWith("node:") ||
            source === "electron" ||
            source.startsWith("@capacitor/") ||
            source === "react-native" ||
            source.startsWith("react-native/") ||
            source === "@lode/desktop-client" ||
            source.startsWith("@lode/desktop-client/") ||
            source === "@lode/engine" ||
            source.startsWith("@lode/engine/") ||
            source.startsWith("@lode/app-");
          if (hostOwned) {
            context.report({
              node,
              messageId: "restricted",
              data: { message: "The shared web UI cannot depend on a host, product engine, or platform transport." },
            });
          }
        });
      },
    },
  },
};

const rawColorPattern = /#[0-9a-fA-F]{3,8}(?![\w/-])|\b(?:rgba?|hsla?|oklch)\(/;
// Color, spacing, radius, shadow, and type utilities always resolve from the
// token scales; size and position utilities may use relative units (vh, %, fr)
// but never restate an absolute length the spacing scale owns.
const arbitraryUtilityPattern =
  /(?:^|[\s"'`:])(?:bg|text|border|ring|fill|stroke|shadow|rounded|gap|[pm][trblxyse]?|space-[xy])-\[/;
const arbitraryAbsoluteSizePattern =
  /(?:^|[\s"'`:])(?:size|w|h|max-w|min-w|max-h|min-h|inset|top|right|bottom|left)-\[[^\]]*(?:px|rem)/;

const designPlugin = {
  rules: {
    "no-raw-visual-values": {
      meta: { type: "problem", schema: [], messages: { restricted: "{{message}}" } },
      create(context) {
        const check = (value, node) => {
          if (typeof value !== "string") {
            return;
          }
          if (rawColorPattern.test(value)) {
            context.report({
              node,
              messageId: "restricted",
              data: { message: "Colors resolve from semantic design tokens, never raw color literals." },
            });
            return;
          }
          if (arbitraryUtilityPattern.test(value) || arbitraryAbsoluteSizePattern.test(value)) {
            context.report({
              node,
              messageId: "restricted",
              data: {
                message: "Token-owned utilities (color, spacing, size, radius, shadow) never take arbitrary values.",
              },
            });
          }
        };
        return {
          Literal(node) {
            check(node.value, node);
          },
          TemplateElement(node) {
            check(node.value.cooked ?? node.value.raw, node);
          },
        };
      },
    },
    "product-through-components": {
      meta: { type: "problem", schema: [], messages: { restricted: "{{message}}" } },
      create(context) {
        const controls = new Set(["button", "input", "select", "textarea"]);
        return {
          JSXOpeningElement(node) {
            if (node.name.type === "JSXIdentifier" && controls.has(node.name.name)) {
              context.report({
                node,
                messageId: "restricted",
                data: { message: `Screens render <${node.name.name}> through the ui component layer.` },
              });
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/src/gen/**",
      "**/src/dto-gen/**",
      "**/*.config.js",
      "**/*.config.mjs",
      "vitest.config.ts",
      "packages/daemon/vitest.config.ts",
      "packages/engine/vitest.config.ts",
      "packages/engine/tests/benchmark/**",
      "experiments/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx,cts}"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked, prettier],
    plugins: { "node-import": nodeImport, unicorn, architecture: architecturePlugin, design: designPlugin },
    languageOptions: {
      parserOptions: { project: "tsconfig.eslint.json", tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/array-type": "error",
      "@typescript-eslint/consistent-type-assertions": "error",
      "@typescript-eslint/no-unnecessary-template-expression": "error",
      "@typescript-eslint/prefer-function-type": "error",
      "@typescript-eslint/prefer-includes": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      curly: "error",
      "no-unneeded-ternary": "error",
      "no-useless-return": "error",
      "prefer-template": "error",
      "prefer-const": "error",
      "no-console": "warn",
      "node-import/prefer-node-protocol": "error",
      "unicorn/error-message": "error",
      "unicorn/throw-new-error": "error",
      "unicorn/no-instanceof-builtins": "error",
      "unicorn/no-useless-promise-resolve-reject": "error",
      "unicorn/prefer-at": "error",
      "unicorn/prefer-date-now": "error",
      "unicorn/prefer-math-min-max": "error",
      "unicorn/prefer-negative-index": "error",
      "unicorn/prefer-object-from-entries": "error",
      "unicorn/prefer-ternary": "error",
      "unicorn/consistent-empty-array-spread": "error",
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["apps/mobile/src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { project: "apps/mobile/tsconfig.json", tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["apps/mobile/src/**/*.tsx"],
    rules: {
      "design/no-raw-visual-values": "error",
      "design/product-through-components": "error",
      "no-restricted-globals": ["error", "Buffer", "__dirname", "__filename", "global", "module", "process", "require"],
    },
  },
  {
    files: ["apps/mobile/src/**/*.{ts,tsx}"],
    ignores: ["apps/mobile/src/engine-worker/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@lode/engine", "@lode/engine/**", "@lode/engine-platform-mobile"],
              message: "The Android UI reaches the Engine only through its dedicated Web Worker client.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/desktop/src/**/*.{ts,tsx,cts}"],
    languageOptions: {
      parserOptions: { project: "apps/desktop/tsconfig.json", tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "architecture/desktop-product-boundary": "error",
    },
  },
  {
    files: ["apps/desktop/src/**/*.test.ts"],
    languageOptions: {
      parserOptions: { project: "apps/desktop/tsconfig.test.json", tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["packages/ui/src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { project: "packages/ui/tsconfig.json", tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "architecture/ui-host-neutral": "error",
    },
  },
  {
    files: ["packages/ui/src/**/*.test.ts"],
    languageOptions: {
      parserOptions: { project: "packages/ui/tsconfig.test.json", tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["apps/desktop/src/renderer.tsx", "apps/desktop/src/renderer/**/*.tsx", "packages/ui/src/**/*.tsx"],
    rules: {
      "no-restricted-globals": ["error", "Buffer", "__dirname", "__filename", "global", "module", "process", "require"],
      "design/no-raw-visual-values": "error",
    },
  },
  {
    files: ["apps/desktop/src/renderer.tsx", "apps/desktop/src/renderer/**/*.tsx", "packages/ui/src/catalog/**/*.tsx"],
    rules: {
      "design/product-through-components": "error",
    },
  },
  {
    files: ["packages/engine/src/crypto/bytes.ts"],
    rules: {
      "node-import/prefer-node-protocol": "off",
    },
  },
  {
    files: [
      "packages/engine/src/**/*.ts",
      "packages/engine-platform-desktop/src/**/*.ts",
      "packages/engine-platform-mobile/src/**/*.ts",
    ],
    rules: {
      "architecture/engine-platform-direction": "error",
    },
  },
  {
    files: ["packages/engine/src/**/*.ts"],
    rules: {
      "architecture/engine-owner-location": "error",
    },
  },
  {
    files: ["packages/engine/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?:\\./|(?:\\.\\./)+)(?:domain/)?authored-intent/(?!index\\.js$).+",
              message:
                "Authored Intent validation is consumed through its public domain seam, never its family internals.",
            },
            {
              regex: "^(?:\\./|(?:\\.\\./)+)(?:domain/)?review/(?!index\\.js$).+",
              message: "Review is consumed through its public domain seam, never its family internals.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/domain/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../subsystems/**",
                "loro-crdt",
                "@lode/protocol",
                "@lode/sdk",
                "@lode/desktop-client",
                "@bufbuild/**",
              ],
              message: "Domain policy cannot depend on applications, subsystem owners, storage, CRDTs, or wire types.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/crypto/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../domain/**",
                "../subsystems/**",
                "loro-crdt",
                "@lode/protocol",
                "@lode/sdk",
                "@lode/desktop-client",
                "@bufbuild/**",
              ],
              message: "The crypto leaf is a neutral substrate and cannot depend on engine concepts or layers.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/decoding/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../crypto/**", "../domain/**", "../subsystems/**"],
              message: "Decoding is a neutral leaf and cannot depend on Engine concepts or runtime owners.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/domain/activation/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../conflict/**", "../history/**", "../reconcile/**", "../review/**"],
              message: "Fact activation is a lower-level policy and depends only on Fact vocabulary.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/domain/reconcile/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../history/**", "../review/**"],
              message: "Projection reconciliation cannot depend on its Review or History consumers.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/domain/conflict/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../history/**", "../reconcile/**", "../review/**"],
              message: "Conflict policy exposes issues to Projection and cannot depend back on it.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/subsystems/persistence/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../domain/**",
                "../connection/**",
                "../event/**",
                "../identity/**",
                "../synchronization/**",
                "../workspace/**",
                "loro-crdt",
                "@lode/sdk",
                "@lode/sdk/**",
              ],
              message: "Persistence owns storage resources and cannot depend on Domain or another runtime owner.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/subsystems/identity/**/*.ts", "packages/engine/src/subsystems/workspace/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "architecture/persistence-seam": "error",
    },
  },
  {
    files: ["packages/engine/src/subsystems/workspace/authority/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../../domain/history/**",
                "../../../domain/reconcile/**",
                "../../../domain/review/**",
                "../application/**",
                "../authority-coordination/**",
                "../command/**",
                "../edit-planning/**",
                "../projection/**",
                "../query/**",
                "../workspace*.js",
              ],
              message:
                "Fact authority cannot depend on projections, review, history, applications, or workspace orchestration.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/subsystems/workspace/authority/loro-fact-*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../../domain/history/**",
                "../../../domain/reconcile/**",
                "../../../domain/review/**",
                "../application/**",
                "../authority-coordination/**",
                "../command/**",
                "../edit-planning/**",
                "../projection/**",
                "../query/**",
                "../workspace*.js",
                "./fact-authority.js",
              ],
              message:
                "The authoritative Loro Fact store owns durable and synchronized Fact state without depending on commit planning or its facade.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/subsystems/workspace/**/*.ts"],
    ignores: ["**/*.test.ts", "**/authority/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?:\\.\\./)+synchronization(?:/|\\.js$)",
              message: "Workspace orchestration does not depend on sync composition.",
            },
            {
              regex: "^(?:\\.\\./){2,}domain/reconcile/(?!index\\.js$).+",
              message:
                "Workspace orchestration consumes the public Reconcile contract, never its internal projection algorithms.",
            },
            {
              regex:
                "^(?:\\./|(?:\\.\\./)+)(?:authority-coordination|command|edit-planning|projection|query)/(?!index\\.js$).+",
              message:
                "Workspace orchestration modules are consumed through their public funnels, never their internals.",
            },
            {
              regex: "^(?:\\.\\./)+(?:authority-coordination|command|query)/index\\.js$",
              message: "Workspace command, query, and authority use cases remain independent sibling modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/subsystems/workspace/application/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../authority/**",
                "../authority-coordination/**",
                "../command/**",
                "../edit-planning/**",
                "../projection/**",
                "../query/**",
                "../workspace*.js",
                "../../connection/**",
                "../../event/**",
                "../../identity/**",
                "../../persistence/**",
                "../../synchronization/**",
                "loro-crdt",
                "@bufbuild/**",
              ],
              message: "Workspace application decoding depends only on the SDK contract, Domain, and neutral decoding.",
            },
          ],
        },
      ],
    },
  },
  ...[
    {
      owner: "event",
      forbidden: ["connection", "identity", "persistence", "synchronization", "workspace"],
    },
    {
      owner: "persistence",
      forbidden: ["connection", "event", "identity", "synchronization", "workspace"],
    },
    {
      owner: "identity",
      forbidden: ["connection", "event", "synchronization", "workspace"],
    },
    {
      owner: "connection",
      forbidden: ["event", "identity", "persistence", "synchronization", "workspace"],
    },
    {
      owner: "workspace",
      forbidden: ["connection", "synchronization"],
    },
    {
      owner: "synchronization",
      forbidden: ["event", "persistence"],
    },
  ].map(({ owner, forbidden }) => ({
    files: [`packages/engine/src/subsystems/${owner}/**/*.ts`],
    ignores: ["**/*.test.ts"],
    rules: {
      "architecture/subsystem-dependencies": ["error", { owner, forbidden }],
    },
  })),
  {
    files: ["packages/engine/src/**/*.ts"],
    ignores: ["**/*.test.ts", "packages/engine/src/engine.ts", "packages/engine/src/subsystems/index.ts"],
    rules: {
      "architecture/engine-composition": "error",
    },
  },
  {
    files: ["packages/engine/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "architecture/engine-transport-neutral": "error",
    },
  },
  {
    files: ["packages/sdk/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@lode/engine",
                "@lode/engine/**",
                "@lode/daemon",
                "@lode/daemon/**",
                "@lode/desktop-client",
                "@connectrpc/**",
              ],
              message:
                "The SDK owns the wire codec on generated contracts and the protobuf runtime, but cannot depend on an engine implementation or transport library.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/desktop-client/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@lode/engine", "@lode/engine/**"],
              message: "Desktop clients consume the host-neutral @lode/sdk contract, never the Engine implementation.",
            },
            {
              group: ["@lode/daemon", "@lode/daemon/**"],
              message: "Desktop callers reach the daemon through @lode/desktop-client, never its host implementation.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/cli/src/**/*.ts"],
    ignores: ["**/*.test.ts", "**/tests/**"],
    rules: {
      "architecture/cli-product-boundary": "error",
    },
  },
  {
    // CLI one-way module architecture.
    files: ["apps/cli/src/**/*.ts"],
    ignores: [
      "**/*.test.ts",
      "apps/cli/src/composition.ts",
      "apps/cli/src/session/index.ts",
      "apps/cli/src/manage/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@lode/desktop-client", "@lode/desktop-client/**"],
              message: "Only the composition root and the desktop session adapter own the transport.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/cli/src/families/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "architecture/cli-family-dependencies": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@lode/desktop-client",
                "@lode/desktop-client/**",
                "../output/index.js",
                "node:process",
                "node:fs",
                "node:fs/promises",
                "node:os",
                "node:child_process",
              ],
              message:
                "Product families compose the SDK contract through shared modules; they own no transport, rendering, or process access.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/cli/src/{output,target,value,command,invocation,catalog}/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@lode/desktop-client",
                "@lode/desktop-client/**",
                "../families/**",
                "../output/index.js",
                "node:process",
              ],
              message:
                "Target/value/command/invocation/catalog/output modules stay below families and never render or dial.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/cli/src/output/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@lode/sdk",
                "@lode/sdk/**",
                "@lode/desktop-client",
                "@lode/desktop-client/**",
                "../families/**",
                "../session/index.js",
                "node:process",
              ],
              message: "Renderers are pure functions over finished outcomes; they never query, dial, or know families.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/daemon/src/**/*.ts"],
    ignores: [
      "**/*.test.ts",
      "packages/daemon/src/run-daemon.ts",
      "packages/daemon/src/peer-exchange-server.ts",
      "packages/daemon/src/peer-exchange-transport.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@lode/engine", "@lode/engine/**"],
              message:
                "Only the daemon process module (run-daemon) composes a concrete Engine; everything else depends on the host-neutral contract.",
            },
            {
              group: ["@lode/desktop-client", "@lode/desktop-client/**"],
              message: "The daemon host publishes the Engine service and cannot depend on its desktop consumer.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/daemon/src/peer-exchange-server.ts", "packages/daemon/src/peer-exchange-transport.ts"],
    rules: {
      "architecture/daemon-peer-ports": "error",
    },
  },
  {
    files: ["packages/engine/src/**/*.ts"],
    ignores: ["**/*.test.ts", "packages/engine/src/subsystems/workspace/authority/loro-fact-*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value='loro-crdt']",
          message: "Loro belongs only in the authoritative Fact store.",
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/**/index.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportAllDeclaration",
          message: "Engine module seams list their exports explicitly so internal helpers cannot leak by accident.",
        },
      ],
    },
  },
  {
    // JSX lays one attribute per line, so a TSX file carries roughly two-thirds
    // fewer concepts per line than plain TS; the tripwire moves accordingly.
    files: ["**/*.tsx"],
    rules: { "max-lines": ["error", { max: 450, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ["**/*.test.ts"],
    rules: { "max-lines": "off" },
  },
);
