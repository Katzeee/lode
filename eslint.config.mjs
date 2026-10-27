// Purpose: Configures repository lint rules for TypeScript source and tests.

import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import nodeImport from "eslint-plugin-node-import";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/node_modules/**",
      "_local/**",
      "**/src/gen/**",
      "**/*.config.js",
      "**/*.config.mjs",
    ],
  },
  {
    files: ["**/*.{ts,tsx,cts}"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked, prettier],
    plugins: { "node-import": nodeImport, unicorn },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/array-type": "error",
      "@typescript-eslint/consistent-type-assertions": "error",
      "@typescript-eslint/no-unnecessary-template-expression": "error",
      "@typescript-eslint/prefer-function-type": "error",
      "@typescript-eslint/prefer-includes": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      curly: "error",
      "no-unneeded-ternary": "error",
      "no-useless-return": "error",
      "prefer-template": "error",
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
    // node:test's `test()` returns a promise its runner awaits.
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        { allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "describe", "it"] }] },
      ],
    },
  },
);
