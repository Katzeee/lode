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
  // Architecture boundaries (AGENTS.md: services -> domain -> core; engine ↛ client).
  // Enforced automatically so a future PR can't silently cross them. Tests may cross layers
  // (e.g. cascade-exhaustive drives the domain cascade from a core test), so *.test.ts is exempt.
  // NB: flat-config rule values don't merge across blocks (last-wins), so the three blocks use
  // NON-overlapping file scopes — each src file matches exactly one — and each carries the full
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
                "**/services/**",
                "**/bundle/**",
                "**/event/**",
                "**/session/**",
                "**/persistence/**",
                "**/runtime/**",
              ],
              message: "core must not import above layers — engine layers services -> domain -> core.",
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
              group: ["../services/*", "../../services/*"],
              message: "domain must not import services — services sit above domain.",
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
    // bundle: declarative built-in schema vocabulary — pure leaf, no engine imports.
    files: ["packages/engine/src/bundle/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../**"],
              message: "bundle is a pure leaf — no engine imports.",
            },
            {
              group: ["@lode/protocol", "@lode/client"],
              message: "bundle must not import the wire contract or any client.",
            },
          ],
        },
      ],
    },
  },
  {
    // event: low-level notification primitive — imports only the protocol.
    files: ["packages/engine/src/event/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../**"],
              message: "event is a low-level notification primitive — import only the protocol.",
            },
            {
              group: ["@lode/client"],
              message: "event must not import any client.",
            },
          ],
        },
      ],
    },
  },
  {
    // session: session/subscription/broadcast — sits below services; imports only event + protocol.
    files: ["packages/engine/src/session/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../core/**",
                "../domain/**",
                "../services/**",
                "../persistence/**",
                "../bundle/**",
              ],
              message: "session sits below services — import only event + protocol.",
            },
            {
              group: ["@lode/client"],
              message: "session must not import any client.",
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
    // utils/crypto: pure crypto leaf (node:crypto + @noble/curves + @scure/bip39 + sibling files).
    // No engine internals, no persistence, no protocol, no client — the standardized layer that
    // travels inside the engine's future Rust dynamic-library form (cross-implementation KAT parity).
    files: ["packages/engine/src/utils/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../**"],
              message: "utils/crypto is a pure leaf — no engine internals.",
            },
            {
              group: ["@lode/protocol", "@lode/client"],
              message: "utils/crypto must not import the wire contract or any client.",
            },
          ],
        },
      ],
    },
  },
  {
    // services / runtime / top-level src (index.ts): adapter + composition layers; may use any
    // internal layer + protocol, never client.
    files: ["packages/engine/src/**/*.ts"],
    ignores: [
      "packages/engine/src/core/**",
      "packages/engine/src/domain/**",
      "packages/engine/src/bundle/**",
      "packages/engine/src/event/**",
      "packages/engine/src/session/**",
      "packages/engine/src/persistence/**",
      "packages/engine/src/utils/**",
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
