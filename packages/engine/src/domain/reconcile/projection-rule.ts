import type { ProjectionPlanContext } from "./projection-plan-context.js";
import type { ProjectionArtifactKey, ProjectionStage, ProjectionStageKey } from "./projection-plan-dag.js";

type ProjectionRule = ProjectionStage<ProjectionPlanContext, ProjectionStageKey, ProjectionArtifactKey>;

const PROJECTION_STAGE_ARTIFACTS = {
  activation: "activation",
  node: "storedNodes",
  configuration: "metanodes",
  occurrence: "authoredStructure",
  content: "contentNodes",
  "node-graph": "nodeGraphStructure",
  "supertag-relations": "supertagRelations",
  "field-definition": "fieldDefinitionConfigurations",
  search: "searchExpressions",
  view: "sharedDefaultViewDefinitions",
  conflict: "conflictIssues",
  template: "templateStructure",
  assembly: "projection",
} as const satisfies Readonly<Record<ProjectionStageKey, ProjectionArtifactKey>>;

type ProjectionStageArtifact = typeof PROJECTION_STAGE_ARTIFACTS;

type ProjectionPlanInputKey = Exclude<keyof ProjectionPlanContext, ProjectionArtifactKey>;

type ProjectionRuleContext<
  Key extends ProjectionStageKey,
  Dependencies extends readonly ProjectionStageKey[],
> = Readonly<
  Pick<
    ProjectionPlanContext,
    ProjectionPlanInputKey | ProjectionStageArtifact[Key] | ProjectionStageArtifact[Dependencies[number]]
  >
>;

export function projectionRule<
  const Key extends ProjectionStageKey,
  const Dependencies extends readonly ProjectionStageKey[],
>(definition: {
  key: Key;
  dependencies: Dependencies;
  evaluate(
    context: ProjectionRuleContext<Key, Dependencies>,
  ): Pick<ProjectionPlanContext, ProjectionStageArtifact[Key]>;
}): ProjectionRule {
  const writes = [PROJECTION_STAGE_ARTIFACTS[definition.key]] as const;
  return {
    key: definition.key,
    dependencies: definition.dependencies,
    writes,
    evaluate(context) {
      const update = definition.evaluate(context);
      const declared = [...writes].sort();
      const actual = Object.keys(update).sort();
      if (declared.length !== actual.length || declared.some((output, index) => output !== actual[index])) {
        throw new Error(
          `Projection stage ${definition.key} returned [${actual.join(", ")}] but declares [${declared.join(", ")}]`,
        );
      }
      Object.assign(context, update);
    },
  };
}
