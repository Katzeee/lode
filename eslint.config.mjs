import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import nodeImport from "eslint-plugin-node-import";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

const tsFiles = ["**/*.ts"];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/tests/benchmark/**",
      "**/src/gen/**",
      "**/*.config.js",
      "**/*.config.mjs",
      "**/*.config.ts",

      // Isolated research/verification prototypes — not production code, not
      // type-checked or linted by the monorepo config. See experiments/*.
      "experiments/**",
    ],
  },
  {
    files: tsFiles,
    extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked, prettier],
    plugins: {
      "node-import": nodeImport,
      unicorn,
    },
    languageOptions: {
      parserOptions: {
        project: "tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
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
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

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
  // Per-function length backstop (primary complexity signal; max-lines above is the per-file one).
  // Relaxed from the draft's 80 to 100 — at 80 the engine had 21 violations, almost all cohesive-
  // but-exhaustive (undo algorithm, RPC handler registration, recursive serializers, integration
  // tests), not the low-cohesion "one function doing too much" smell the rule targets. Tests are
  // exempt (integration scenarios run long); production src over 100 must justify itself with an
  // inline `eslint-disable-next-line max-lines-per-function -- <reason>` debt marker.
  {
    files: ["packages/engine/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "max-lines-per-function": [
        "error",
        { max: 100, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // Architecture boundaries (AGENTS.md: commands -> runtime -> domain -> core; runtime ↛ commands;
  // engine ↛ client). Enforced automatically so a future PR can't silently cross them. Tests may
  // cross layers (e.g. cascade-exhaustive drives the domain cascade from a core test), so *.test.ts
  // is exempt. NB: flat-config rule values don't merge across blocks (last-wins), so the layer blocks
  // use NON-overlapping file scopes — each src file matches exactly one — and each carries the full
  // restriction set for its layer.
  {
    files: ["packages/engine/src/core/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/domain/**",
                "**/commands/**",
                "**/persistence/**",
                "**/runtime/**",
              ],
              message:
                "core must not import above layers — engine layers commands -> runtime -> domain -> core.",
            },
            {
              group: ["@lode/protocol", "@lode/client"],
              message: "core must not import the wire contract or any client.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/domain/**/*.ts"],
    ignores: ["packages/engine/src/domain/model/**", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../commands/*", "../../commands/*"],
              message: "domain must not import commands — commands sit above domain.",
            },
            {
              group: ["@lode/protocol", "@lode/client"],
              message: "domain must not import the wire contract or any client.",
            },
          ],
        },
      ],
    },
  },
  {
    // domain/model: pure value-type leaf — imports only sibling model files.
    files: ["packages/engine/src/domain/model/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*", "../../**"],
              message:
                "domain/model is a pure value-type leaf — import only sibling model files.",
            },
            {
              group: ["@lode/protocol", "@lode/client"],
              message: "domain/model must not import the wire contract or any client.",
            },
          ],
        },
      ],
    },
  },
  {
    // persistence: storage primitives (SQLite CRUD on bytes/records) — pure leaf, no engine imports.
    files: ["packages/engine/src/persistence/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../**"],
              message: "persistence storage primitives must not import engine internals.",
            },
            {
              group: ["@lode/protocol", "@lode/client"],
              message: "persistence must not import the wire contract or any client.",
            },
          ],
        },
      ],
    },
  },
  {
    // Neutral primitives — crypto (node:crypto + @noble/curves + @scure/bip39) + errors: pure leaves,
    // no engine internals, no protocol, no client. The standardized substrate that travels inside the
    // engine's future Rust dynamic-library form (cross-implementation KAT parity).
    files: [
      "packages/engine/src/crypto/**/*.ts",
      "packages/engine/src/errors/**/*.ts",
    ],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../**"],
              message: "neutral primitives (crypto/errors) are pure leaves — no engine internals.",
            },
            {
              group: ["@lode/protocol", "@lode/client"],
              message: "neutral primitives must not import the wire contract or any client.",
            },
          ],
        },
      ],
    },
  },
  {
    // runtime: stateful subsystems (workspace registry, identity, notification, sync, broker,
    // membership, lifecycle). May import down (domain/core/leaves) + protocol; never the command
    // handlers (they sit above runtime — handlers orchestrate it) and never a client.
    files: ["packages/engine/src/runtime/**/*.ts"],
    ignores: ["**/*.test.ts", "packages/engine/src/runtime/membership/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/commands/**"],
              message:
                "runtime must not import command handlers — handlers sit above runtime and orchestrate it.",
            },
            {
              group: ["@lode/client"],
              message: "runtime must not import any client.",
            },
          ],
        },
      ],
    },
  },
  {
    // membership: the signed-roster domain — sync-independent. sync syncs it (one-way sync ->
    // membership); membership must not reach up into sync. That was a false split — the MembershipSync
    // adapter moved to sync/ — and this rule locks it. The runtime-wide bans (no commands, no client)
    // carry over (membership is excluded from the runtime block above, so it needs the full set here).
    files: ["packages/engine/src/runtime/membership/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/sync/**"],
              message:
                "membership must not import sync — sync depends on membership (one-way); the MembershipSync adapter lives in sync/.",
            },
            {
              group: ["**/commands/**"],
              message:
                "runtime must not import command handlers — handlers sit above runtime and orchestrate it.",
            },
            {
              group: ["@lode/client"],
              message: "runtime must not import any client.",
            },
          ],
        },
      ],
    },
  },
  {
    // commands + the apex (composition root engine-runtime.ts, index.ts): adapter/composition layers.
    // May use any internal layer + protocol, never a client.
    files: ["packages/engine/src/**/*.ts"],
    ignores: [
      "packages/engine/src/core/**",
      "packages/engine/src/domain/**",
      "packages/engine/src/persistence/**",
      "packages/engine/src/crypto/**",
      "packages/engine/src/errors/**",
      "packages/engine/src/runtime/**",
      "**/*.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@lode/client"],
              message: "engine must not import client — that lives in @lode/daemon.",
            },
          ],
        },
      ],
    },
  },
);
