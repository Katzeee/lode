import { stableStringCompare } from "../fact/index.js";

export type ProjectionStage<Context = unknown, StageKey extends string = string> = Readonly<{
  key: StageKey;
  dependencies: readonly StageKey[];
  evaluate(context: Context): void;
}>;

type CompiledProjectionPlan<Context = unknown, StageKey extends string = string> = Readonly<{
  ordered: readonly ProjectionStage<Context, StageKey>[];
  run(context: Context): void;
}>;

export function compileProjectionPlan<Context, StageKey extends string = string>(
  stages: readonly ProjectionStage<Context, StageKey>[],
): CompiledProjectionPlan<Context, StageKey> {
  const byKey = new Map<StageKey, ProjectionStage<Context, StageKey>>();
  for (const stage of stages) {
    if (byKey.has(stage.key)) {
      throw new Error(`Duplicate Projection Artifact owner: ${stage.key}`);
    }
    byKey.set(stage.key, stage);
  }
  for (const stage of stages) {
    for (const dependency of stage.dependencies) {
      if (!byKey.has(dependency)) {
        throw new Error(`Projection Artifact ${stage.key} has missing dependency ${dependency}`);
      }
    }
  }

  const ordered: ProjectionStage<Context, StageKey>[] = [];
  const remaining = new Set(byKey.keys());
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((key) => byKey.get(key)!.dependencies.every((dependency) => !remaining.has(dependency)))
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
    run(context) {
      for (const rule of ordered) {
        rule.evaluate(context);
      }
    },
  };
}
