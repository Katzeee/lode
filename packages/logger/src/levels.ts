// Per-prefix log-level spec parser — mirrors any-sync's `LevelsFromStr` + anytype's
// `ANYTYPE_LOG_LEVEL`. Pure (no env, no pino) so it is unit-testable in isolation; `index.ts`
// reads `LODE_LOG` and feeds the spec here.
//
// Spec grammar: `name=LEVEL;prefix*=LEVEL;*=WARN` — semicolon-separated, each entry is `key=LEVEL`
// where `key` is a glob (`*` wildcard). A bare value with no `=` is treated as `*=value`. First
// matching rule wins (in entry order); unknown levels are dropped.

/** pino level vocabulary (`silent` mutes everything). */
export type Level = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

const LEVELS: ReadonlySet<string> = new Set([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
]);

export type LevelRule = {
  match: (name: string) => boolean;
  level: Level;
};

/** Parse a spec string into ordered rules. Empty/whitespace entries are skipped; unknown levels
 *  are dropped (so a typo never silently locks a subsystem at the wrong level — it falls back). */
export function parseLevelSpec(spec: string): LevelRule[] {
  const rules: LevelRule[] = [];
  for (const part of spec.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    const key = eq === -1 ? "*" : trimmed.slice(0, eq).trim();
    const val = eq === -1 ? trimmed : trimmed.slice(eq + 1).trim();
    const level = val.toLowerCase();
    if (!LEVELS.has(level)) {
      continue;
    }
    const re = globToRegExp(key);
    rules.push({ match: (name) => re.test(name), level: level as Level });
  }
  return rules;
}

/** Resolve a component name to its level. First-match-wins; `fallback` when no rule matches. */
export function resolveLevel(name: string, rules: readonly LevelRule[], fallback: Level): Level {
  for (const rule of rules) {
    if (rule.match(name)) {
      return rule.level;
    }
  }
  return fallback;
}

/** Convert a glob (`*` → any chars) into an anchored RegExp. Escapes regex metacharacters so a
 *  dotted component name like `sync.registry` matches literally. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
