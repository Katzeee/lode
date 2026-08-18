import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import nodeImport from "eslint-plugin-node-import";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

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
      "**/*.config.ts",
      "experiments/**",
    ],
  },
  {
    files: ["**/*.ts"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked, prettier],
    plugins: { "node-import": nodeImport, unicorn },
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
    ignores: ["**/*.test.ts"],
    rules: {
      "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@lode/protocol", "@lode/protocol/**", "@lode/desktop-client", "@bufbuild/**"],
              message: "Engine contracts and domain code are transport-neutral.",
            },
            {
              regex: "^(?:\\./|(?:\\.\\./)+)(?:domain/)?mutation-evidence/(?!index\\.js$).+",
              message: "Mutation evidence is consumed through its public domain seam, never its family internals.",
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
                "../../application/**",
                "../../runtime/**",
                "../../persistence/**",
                "../../sync/**",
                "loro-crdt",
                "@lode/protocol",
                "@lode/sdk",
                "@lode/desktop-client",
                "@bufbuild/**",
              ],
              message: "Domain policy cannot depend on applications, runtime, storage, CRDTs, or wire types.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/shape-validation/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../application/**", "../domain/**", "../persistence/**", "../runtime/**", "../sync/**"],
              message: "Shape validation is a neutral leaf and cannot depend on engine concepts or layers.",
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
              group: ["../{admission,conflict,history,reconcile,review}/**"],
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
              group: ["../{admission,conflict,history,reconcile,review}/**"],
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
    files: ["packages/engine/src/application/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../runtime/**", "../persistence/**", "../sync/**", "loro-crdt", "@bufbuild/**"],
              message: "Engine application adapters depend only on the SDK contract and domain-owned types.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/persistence/**/*.ts", "packages/engine/src/sync/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../application/**", "../domain/**", "../runtime/**", "loro-crdt"],
              message: "Persistence and sync ports are neutral substrate modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/runtime/authority/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../application/**", "../../domain/{history,reconcile,review}/**", "../workspace/**"],
              message:
                "Fact authority cannot depend on projections, review, history, applications, or workspace orchestration.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/runtime/authority/authority-commit-plan.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../application/**",
                "../../domain/{history,reconcile,review}/**",
                "../../persistence/**",
                "../../sync/**",
                "../workspace/**",
                "./authority-journal-*.js",
                "./authority-sync-*.js",
                "./fact-authority-store*.js",
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
    files: ["packages/engine/src/runtime/authority/authority-journal-session.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../application/**",
                "../../domain/{history,reconcile,review}/**",
                "../../sync/**",
                "../workspace/**",
                "./authority-commit-plan.js",
                "./authority-sync-*.js",
                "./fact-authority-store.js",
                "./loro-*.js",
              ],
              message:
                "The authority journal owns durable authority state and cannot depend on commit, sync, or store orchestration.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/runtime/authority/authority-sync-import.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../application/**",
                "../../domain/{history,reconcile,review}/**",
                "../../persistence/**",
                "../workspace/**",
                "./authority-commit-plan.js",
                "./authority-journal-*.js",
                "./fact-authority-store.js",
              ],
              message:
                "Authority sync import coordinates a replica through explicit callbacks and cannot own journal or store state.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/runtime/workspace/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../sync/**"],
              message: "Workspace orchestration does not depend on sync composition.",
            },
            {
              regex: "^(?:\\.\\./){2,}domain/reconcile/(?!index\\.js$).+",
              message:
                "Workspace orchestration consumes the public Reconcile contract, never its internal projection algorithms.",
            },
            {
              regex: "^(?:\\.\\./)+materialization/(?!index\\.js$).+",
              message: "Workspace orchestration consumes Materialization through its public ports.",
            },
            {
              regex:
                "^(?:\\./|(?:\\.\\./)+)(?:authority-lifecycle|command|generation-reading|mutation-planning|projection-lifecycle|query)/(?!index\\.js$).+",
              message:
                "Workspace orchestration modules are consumed through their public funnels, never their internals.",
            },
            {
              regex: "^(?:\\.\\./)+(?:authority-lifecycle|command|query)/index\\.js$",
              message: "Workspace command, query, and authority use cases remain independent sibling modules.",
            },
            {
              group: ["../proposal-registry.js", "../proposal-storage.js", "../proposal-workspace.js"],
              message: "Workspace use cases cannot depend back on workspace composition.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/runtime/materialization/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../application/**", "../{authority,sync,workspace}/**"],
              message:
                "Projection materialization exposes storage-native data and cannot depend on application contracts, workspace composition, authority, or sync.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "packages/engine/src/runtime/materialization/bounded-materialized-store.ts",
      "packages/engine/src/runtime/materialization/materialize-generation.ts",
      "packages/engine/src/runtime/materialization/materialized-dataset.ts",
      "packages/engine/src/runtime/materialization/materialized-directory.ts",
      "packages/engine/src/runtime/materialization/materialized-format-validation.ts",
      "packages/engine/src/runtime/materialization/materialized-generation-format.ts",
      "packages/engine/src/runtime/materialization/materialized-publication.ts",
      "packages/engine/src/runtime/materialization/materialized-value-validation.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../application/**",
                "../../domain/{reconcile,review}/**",
                "../{authority,sync,workspace}/**",
                "./ports.js",
                "./projection-*.js",
                "./review-*.js",
                "./materialized-projection-*.js",
                "./materialized-review-*.js",
                "./supertag-instances-reader.js",
              ],
              message:
                "The materialized storage kernel depends on dataset contracts, never higher runtime modules or Projection and Review adapters.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/runtime/sync/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../application/**", "../../domain/{history,reconcile,review}/**", "../workspace/**"],
              message: "Fact sync exchanges authority bytes and cannot depend on derived views or App orchestration.",
            },
          ],
        },
      ],
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
              group: ["@lode/desktop-client", "@lode/desktop-client/**", "../families/**", "../../families/**", "../output/index.js", "../../output/index.js", "node:process"],
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
              group: ["@lode/sdk", "@lode/sdk/**", "@lode/desktop-client", "@lode/desktop-client/**", "../families/**", "../session/index.js", "node:process"],
              message: "Renderers are pure functions over finished outcomes; they never query, dial, or know families.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/daemon/src/**/*.ts"],
    ignores: ["**/*.test.ts", "packages/daemon/src/run-daemon.ts"],
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
    files: ["packages/engine/src/**/*.ts"],
    ignores: [
      "**/*.test.ts",
      "packages/engine/src/runtime/authority/fact-sync-projection.ts",
      "packages/engine/src/runtime/authority/loro-fact-replica-state.ts",
      "packages/engine/src/runtime/authority/loro-fact-replica.ts",
      "packages/engine/src/runtime/authority/sync-import-validation.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value='loro-crdt']",
          message: "Loro belongs only in the Fact replication adapter.",
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
