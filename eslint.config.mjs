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
  // Architecture boundaries (AGENTS.md: services -> domain -> core; engine ↛ transport/client).
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
              group: ["@lode/protocol", "@lode/transport", "@lode/client"],
              message: "core must not import the wire contract or any transport/client.",
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
              group: ["@lode/protocol", "@lode/transport", "@lode/client"],
              message: "domain must not import the wire contract or any transport/client.",
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
              group: ["@lode/protocol", "@lode/transport", "@lode/client"],
              message: "domain/model must not import the wire contract or any transport/client.",
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
              group: ["@lode/protocol", "@lode/transport", "@lode/client"],
              message: "bundle must not import the wire contract or any transport/client.",
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
              group: ["@lode/transport", "@lode/client"],
              message: "event must not import any transport/client.",
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
              group: ["@lode/transport", "@lode/client"],
              message: "session must not import any transport/client.",
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
              group: ["@lode/protocol", "@lode/transport", "@lode/client"],
              message: "persistence must not import the wire contract or any transport/client.",
            },
          ],
        },
      ],
    },
  },
  {
    // identity: actor identity primitives + per-dataRoot keystore/catalog — a leaf that may use
    // the persistence storage primitives (sqlite/paths) + node:crypto + sibling identity files,
    // nothing above (no core/domain/services/runtime/bundle/event/session).
    files: ["packages/engine/src/identity/**/*.ts"],
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
                "../runtime/**",
                "../bundle/**",
                "../event/**",
                "../session/**",
              ],
              message:
                "identity is a leaf — may use only persistence storage primitives + node:crypto + sibling identity files.",
            },
            {
              group: ["@lode/protocol", "@lode/transport", "@lode/client"],
              message: "identity must not import the wire contract or any transport/client.",
            },
          ],
        },
      ],
    },
  },
  {
    // utils: generic cross-cutting primitives (crypto, ...) — a pure leaf. Only node: builtins +
    // third-party libs; no engine internals. Mirrors anytype's util/crypto/ (importable by all layers).
    files: ["packages/engine/src/utils/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../**"],
              message: "utils is a pure leaf — no engine imports (only node: builtins + third-party libs).",
            },
            {
              group: ["@lode/protocol", "@lode/transport", "@lode/client"],
              message: "utils must not import the wire contract or any transport/client.",
            },
          ],
        },
      ],
    },
  },
  {
    // services / runtime / top-level src (index.ts): adapter + composition layers; may use any
    // internal layer + protocol, never transport/client.
    files: ["packages/engine/src/**/*.ts"],
    ignores: [
      "packages/engine/src/core/**",
      "packages/engine/src/domain/**",
      "packages/engine/src/bundle/**",
      "packages/engine/src/event/**",
      "packages/engine/src/session/**",
      "packages/engine/src/persistence/**",
      "packages/engine/src/identity/**",
      "packages/engine/src/utils/**",
      "**/*.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@lode/transport", "@lode/client"],
              message: "engine must not import transport/client — that lives in @lode/daemon.",
            },
          ],
        },
      ],
    },
  },
);
