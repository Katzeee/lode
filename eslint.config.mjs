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
      "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
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
              group: ["**/domain/**", "**/commands/**", "**/persistence/**", "**/runtime/**"],
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
              message: "domain/model is a pure value-type leaf — import only sibling model files.",
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
    // Neutral leaves — pure substrates with no layer semantics: depended on by everything above,
    // depending on nothing in the engine (only node built-ins, @lode/logger, and each other). This is
    // STRUCTURAL, not enumerated: any src-level dir that isn't a layer (commands/runtime/domain/core)
    // is a neutral leaf — crypto, errors, persistence, events (the typed Bus + bounded async channel),
    // and any future substrate. Adding a leaf is `mkdir` — no eslint edit. Same purity as before: no
    // engine internals (../**), no protocol, no client.
    files: ["packages/engine/src/**/*.ts"],
    ignores: [
      "packages/engine/src/{commands,runtime,domain,core}/**",
      "packages/engine/src/*.ts",
      "**/*.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../**"],
              message: "neutral leaves (crypto/errors/persistence/events) are pure — no engine internals.",
            },
            {
              group: ["@lode/protocol", "@lode/client"],
              message: "neutral leaves must not import the wire contract or any client.",
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
    // Pure membership policy: normalized records and deterministic replay. Wire codecs, CRDT docs,
    // persistence, and runtime orchestration adapt this module from outside.
    files: ["packages/engine/src/domain/membership/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../core/**",
                "../../runtime/**",
                "../../persistence/**",
                "**/commands/**",
              ],
              message:
                "membership domain policy must not import runtime, storage, core, or commands.",
            },
            {
              group: ["@lode/protocol", "@lode/protocol/**", "@lode/client"],
              message: "membership domain policy must not import wire or client types.",
            },
          ],
        },
      ],
    },
  },
  {
    // Workspace owns workspace lifetimes. Sync/session/relay attach from outside through the
    // WorkspaceRuntime surface and scoped events; workspace never reaches back into them.
    files: ["packages/engine/src/runtime/workspace/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/sync/**", "**/session/**", "**/broker/**", "**/commands/**"],
              message:
                "workspace runtime owns its lifetime and must not import attached subsystems.",
            },
            { group: ["@lode/client"], message: "runtime must not import any client." },
          ],
        },
      ],
    },
  },
  {
    // The content-blind broker is a lower transport substrate. It cannot know sync, membership,
    // workspaces, or sessions; the sync-owned adapter is the only bridge.
    files: ["packages/engine/src/runtime/broker/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/sync/**",
                "**/membership/**",
                "**/workspace/**",
                "**/session/**",
                "**/commands/**",
              ],
              message: "broker is content-blind; bridge it from a concept-owned adapter.",
            },
            { group: ["@lode/client"], message: "runtime must not import any client." },
          ],
        },
      ],
    },
  },
  {
    // Sync core owns its transport port and orchestration, but not a concrete broker. Concrete wire
    // implementations live under sync/adapters and are injected by the composition root.
    files: ["packages/engine/src/runtime/sync/**/*.ts"],
    ignores: ["packages/engine/src/runtime/sync/adapters/**", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/broker/**", "**/commands/**"],
              message: "sync core depends on SyncTransport, never on a concrete broker or command.",
            },
            { group: ["@lode/client"], message: "runtime must not import any client." },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/runtime/sync/adapters/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/commands/**", "@lode/client"],
              message: "sync adapters may implement ports but never depend on commands or clients.",
            },
          ],
        },
      ],
    },
  },
  {
    // Sessions project workspace facts to client streams. They never coordinate sync or broker
    // lifetimes; those are separate scopes.
    files: ["packages/engine/src/runtime/session/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/sync/**", "**/broker/**", "**/commands/**"],
              message: "session delivery must not coordinate sync, broker, or commands.",
            },
            { group: ["@lode/client"], message: "runtime must not import any client." },
          ],
        },
      ],
    },
  },
  {
    // commands + the apex (composition root engine-runtime.ts, index.ts): adapter/composition layers.
    // May use any internal layer + protocol, never a client. Scoped by POSITION (root-level src files
    // + the commands dir), so it needn't re-ignore every neutral leaf — those match the neutral block
    // above, this matches only the apex + commands.
    files: ["packages/engine/src/*.ts", "packages/engine/src/commands/**/*.ts"],
    ignores: ["**/*.test.ts"],
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
