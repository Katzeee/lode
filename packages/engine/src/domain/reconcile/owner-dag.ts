import { stableStringCompare } from "../fact/index.js";

export type OwnerKey = string;

export type OwnerRule<Context = unknown> = Readonly<{
  key: OwnerKey;
  dependencies: readonly OwnerKey[];
  writes: readonly string[];
  evaluate(context: Context): void;
}>;

export type CompiledOwnerDag<Context = unknown> = Readonly<{
  ordered: readonly OwnerRule<Context>[];
  downstream(ownerKeys: ReadonlySet<OwnerKey>): ReadonlySet<OwnerKey>;
  run(context: Context, selected?: ReadonlySet<OwnerKey>): readonly OwnerKey[];
}>;

export function compileOwnerDag<Context>(
  rules: readonly OwnerRule<Context>[],
): CompiledOwnerDag<Context> {
  const byKey = new Map<string, OwnerRule<Context>>();
  const writerByOutput = new Map<string, string>();
  for (const rule of rules) {
    if (byKey.has(rule.key)) {
      throw new Error(`Duplicate owner identity: ${rule.key}`);
    }
    byKey.set(rule.key, rule);
    for (const output of rule.writes) {
      const writer = writerByOutput.get(output);
      if (writer) {
        throw new Error(`Duplicate writer for ${output}: ${writer}, ${rule.key}`);
      }
      writerByOutput.set(output, rule.key);
    }
  }
  for (const rule of rules) {
    for (const dependency of rule.dependencies) {
      if (!byKey.has(dependency)) {
        throw new Error(`Owner ${rule.key} has missing dependency ${dependency}`);
      }
    }
  }

  const ordered: OwnerRule<Context>[] = [];
  const remaining = new Set(byKey.keys());
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((key) =>
        byKey.get(key)!.dependencies.every((dependency) => !remaining.has(dependency)),
      )
      .sort(stableStringCompare);
    if (ready.length === 0) {
      throw new Error(`Owner dependency cycle: ${[...remaining].sort().join(", ")}`);
    }
    for (const key of ready) {
      ordered.push(byKey.get(key)!);
      remaining.delete(key);
    }
  }

  return {
    ordered,
    downstream(ownerKeys) {
      const selected = new Set(ownerKeys);
      let changed = true;
      while (changed) {
        changed = false;
        for (const rule of ordered) {
          if (
            !selected.has(rule.key) &&
            rule.dependencies.some((dependency) => selected.has(dependency))
          ) {
            selected.add(rule.key);
            changed = true;
          }
        }
      }
      return selected;
    },
    run(context, selected) {
      const evaluated: OwnerKey[] = [];
      for (const rule of ordered) {
        if (!selected || selected.has(rule.key)) {
          rule.evaluate(context);
          evaluated.push(rule.key);
        }
      }
      return evaluated;
    },
  };
}
