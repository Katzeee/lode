import { stableStringCompare } from "../fact/index.js";

export type ProjectionStageKey = string;

export type ProjectionStage<Context = unknown> = Readonly<{
  key: ProjectionStageKey;
  dependencies: readonly ProjectionStageKey[];
  writes: readonly string[];
  evaluate(context: Context): void;
}>;

export type CompiledProjectionPlan<Context = unknown> = Readonly<{
  ordered: readonly ProjectionStage<Context>[];
  downstream(stageKeys: ReadonlySet<ProjectionStageKey>): ReadonlySet<ProjectionStageKey>;
  run(context: Context, selected?: ReadonlySet<ProjectionStageKey>): readonly ProjectionStageKey[];
}>;

export function compileProjectionPlan<Context>(
  stages: readonly ProjectionStage<Context>[],
): CompiledProjectionPlan<Context> {
  const byKey = new Map<string, ProjectionStage<Context>>();
  const writerByOutput = new Map<string, string>();
  for (const rule of stages) {
    if (byKey.has(rule.key)) {
      throw new Error(`Duplicate projection stage: ${rule.key}`);
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
  for (const rule of stages) {
    for (const dependency of rule.dependencies) {
      if (!byKey.has(dependency)) {
        throw new Error(`Projection stage ${rule.key} has missing dependency ${dependency}`);
      }
    }
  }

  const ordered: ProjectionStage<Context>[] = [];
  const remaining = new Set(byKey.keys());
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((key) =>
        byKey.get(key)!.dependencies.every((dependency) => !remaining.has(dependency)),
      )
      .sort(stableStringCompare);
    if (ready.length === 0) {
      throw new Error(`Projection stage dependency cycle: ${[...remaining].sort().join(", ")}`);
    }
    for (const key of ready) {
      ordered.push(byKey.get(key)!);
      remaining.delete(key);
    }
  }

  return {
    ordered,
    downstream(stageKeys) {
      const selected = new Set(stageKeys);
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
      const evaluated: ProjectionStageKey[] = [];
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
