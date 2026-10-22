import type {
  ProjectionArtifactKey,
  ProjectionArtifacts,
  ProjectionPlanInputs,
  ProjectionPlanState,
} from "./projection-plan-context.js";
import type { ProjectionStage } from "./projection-plan-dag.js";

type ProjectionStageContext<Dependencies extends readonly ProjectionArtifactKey[]> = Readonly<
  ProjectionPlanInputs & Pick<ProjectionArtifacts, Dependencies[number]>
>;

export function projectionStage<
  const Key extends ProjectionArtifactKey,
  const Dependencies extends readonly ProjectionArtifactKey[],
>(definition: {
  key: Key;
  dependencies: Dependencies;
  project(context: ProjectionStageContext<Dependencies>): ProjectionArtifacts[Key];
}): ProjectionStage<ProjectionPlanState, ProjectionArtifactKey> & Readonly<{ key: Key; dependencies: Dependencies }> {
  return {
    key: definition.key,
    dependencies: definition.dependencies,
    evaluate(state) {
      // The compiled plan runs a Stage only after every declared Artifact owner.
      const context = state as ProjectionStageContext<Dependencies>;
      setArtifact(state, definition.key, definition.project(context));
    },
  };
}

type CompleteProjectionStages<Stages extends readonly ProjectionStage<ProjectionPlanState, ProjectionArtifactKey>[]> =
  Exclude<ProjectionArtifactKey, Stages[number]["key"]> extends never ? unknown : never;

export function projectionStages<
  const Stages extends readonly ProjectionStage<ProjectionPlanState, ProjectionArtifactKey>[],
>(stages: Stages & CompleteProjectionStages<Stages>): Stages {
  return stages;
}

function setArtifact<Key extends ProjectionArtifactKey>(
  state: ProjectionPlanState,
  key: Key,
  value: ProjectionArtifacts[Key],
): void {
  const artifacts: Partial<ProjectionArtifacts> = state;
  artifacts[key] = value;
}
