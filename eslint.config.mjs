import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import nodeImport from "eslint-plugin-node-import";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";
import { dirname, resolve } from "node:path";

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
            const allowed = new Set(["crypto", "decoding", "domain", "subsystems", "engine.ts", "host.ts"]);
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
            source === "@lode/engine/host" &&
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
                  "Daemon Peer adapters import only named Engine-owned Peer Transport port types from @lode/engine/host.",
              },
            });
          }
        });
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
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
      "packages/logger/vitest.config.ts",
      "experiments/**",
    ],
  },
  {
    files: ["**/*.ts"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked, prettier],
    plugins: { "node-import": nodeImport, unicorn, architecture: architecturePlugin },
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
              group: ["../{conflict,history,reconcile,review}/**"],
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
              group: ["../{history,review}/**"],
              message: "Projection reconciliation cannot depend on its Review or History consumers.",
            },
            {
              regex: "^(?:\\./|(?:\\.\\./)+)direct-tail/(?!index\\.js$).+",
              message: "Incremental Projection eligibility is consumed through its family-rule funnel.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/domain/maintenance/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../{conflict,history,reconcile,review}/**"],
              message: "Maintenance policy depends only on Fact vocabulary and lower-level Activation policy.",
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
              group: ["../{history,reconcile,review}/**"],
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
                "../{connection,event,identity,synchronization,workspace}/**",
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
                "../../../domain/{history,reconcile,review}/**",
                "../application/**",
                "../{authority-coordination,command,edit-planning,generation-reading,projection,query}/**",
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
    files: ["packages/engine/src/subsystems/workspace/authority/authority-commit-plan.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../../domain/{history,reconcile,review}/**",
                "../../persistence/**",
                "../application/**",
                "../{authority-coordination,command,edit-planning,generation-reading,projection,query}/**",
                "../replica-sync.js",
                "../workspace*.js",
                "./fact-authority.js",
                "./loro-*.js",
              ],
              message:
                "Authority commit planning is a policy seam and cannot depend on persistence, replication, or the store facade.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/subsystems/workspace/authority/loro-fact-store.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../../domain/{history,reconcile,review}/**",
                "../application/**",
                "../{authority-coordination,command,edit-planning,generation-reading,projection,query}/**",
                "../workspace*.js",
                "./authority-commit-plan.js",
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
    ignores: ["**/*.test.ts", "**/authority/**", "**/materialization/**"],
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
                "^(?:\\./|(?:\\.\\./)+)(?:authority-coordination|command|edit-planning|generation-reading|projection|query)/(?!index\\.js$).+",
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
    files: ["packages/engine/src/subsystems/workspace/projection/materialization/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../application/**",
                "../../../synchronization/**",
                "../../authority/**",
                "../../workspace*.js",
              ],
              message:
                "Projection owns materialization; its storage adapter cannot depend on application contracts, workspace composition, authority, or sync.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/subsystems/workspace/projection/materialization/store/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../../application/**",
                "../../../../../domain/{reconcile,review}/**",
                "../../../../synchronization/**",
                "../../../authority/**",
                "../../../workspace*.js",
              ],
              message:
                "The Workspace materialized storage kernel depends on dataset contracts, never orchestration, sync, or Projection and Review adapters.",
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
                "../{authority,authority-coordination,command,edit-planning,generation-reading,projection,query}/**",
                "../workspace*.js",
                "../../{connection,event,identity,persistence,synchronization}/**",
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
                "@bufbuild/**",
              ],
              message:
                "The SDK can depend on generated protocol contracts, but not an implementation or transport library.",
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
    files: ["apps/{cli,gui,tui}/**/*.ts"],
    ignores: ["**/*.test.ts", "**/tests/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@lode/engine", "@lode/engine/**", "@lode/daemon", "@lode/daemon/**"],
              message: "Desktop apps reach product behavior through @lode/sdk and @lode/desktop-client.",
            },
          ],
        },
      ],
    },
  },
  {
    // CLI MVP one-way module architecture (see the CLI README's ownership table).
    files: ["apps/cli/src/**/*.ts"],
    ignores: [
      "**/*.test.ts",
      "apps/cli/src/domain-cli.ts",
      "apps/cli/src/domain-command-support.ts",
      "apps/cli/src/domain-data-mutations.ts",
      "apps/cli/src/domain-structure-mutations.ts",
      "apps/cli/src/cli.ts",
      "apps/cli/src/composition.ts",
      "apps/cli/src/session/index.ts",
      "apps/cli/src/diagnostics/index.ts",
      "apps/cli/src/manage/**/*.ts",
      "apps/cli/src/daemon-launch.ts",
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
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@lode/desktop-client",
                "@lode/desktop-client/**",
                "../output/index.js",
                "../../output/index.js",
                "node:process",
                "node:fs",
                "node:fs/promises",
                "node:os",
                "node:child_process",
              ],
              message:
                "Product families compose the SDK contract through shared modules; they own no transport, rendering, or process access.",
            },
            {
              regex: "^\\.\\./(?:\\.\\./)?families/[a-z-]+\\.js$",
              message:
                "Command families never import each other; cross-family actions belong to the user command path's family.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/cli/src/{output,target,value,invocation,catalog}/**/*.ts"],
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
                "../../families/**",
                "../output/index.js",
                "../../output/index.js",
                "node:process",
              ],
              message: "Target/value/invocation/catalog/output modules stay below families and never render or dial.",
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
    ignores: ["**/*.test.ts", "packages/engine/src/subsystems/workspace/authority/loro-fact-store.ts"],
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
    files: ["**/*.test.ts"],
    rules: { "max-lines": "off" },
  },
);
