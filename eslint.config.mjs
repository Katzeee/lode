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
              group: ["@lode/protocol", "@lode/protocol/**", "@lode/client", "@bufbuild/**"],
              message: "Engine contracts and domain code are transport-neutral.",
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
                "@lode/client",
                "@bufbuild/**",
              ],
              message:
                "Domain policy cannot depend on applications, runtime, storage, CRDTs, or wire types.",
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
              group: [
                "../runtime/**",
                "../persistence/**",
                "../sync/**",
                "loro-crdt",
                "@bufbuild/**",
              ],
              message: "The App contract depends only on domain-owned types.",
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
              group: [
                "../../application/**",
                "../../domain/{history,reconcile,review}/**",
                "../workspace/**",
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
              group: [
                "../../application/**",
                "../../domain/{history,reconcile,review}/**",
                "../workspace/**",
              ],
              message:
                "Fact sync exchanges authority bytes and cannot depend on derived views or App orchestration.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/**/*.ts", "packages/ipc/client/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@lode/engine/server", "@lode/engine/server/**"],
              message: "App and client code can only import the typed @lode/engine App contract.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: { "max-lines": "off" },
  },
);
