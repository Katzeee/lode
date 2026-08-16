import type { Fact, Mutation } from "../fact/index.js";
import type { ProjectionPlanContext } from "./projection-plan-context.js";
import type { ProjectionArtifactKey, ProjectionStage, ProjectionStageKey } from "./projection-plan-dag.js";

export type ProjectionRule = ProjectionStage<ProjectionPlanContext, ProjectionStageKey, ProjectionArtifactKey> &
  Readonly<{
    factScope: "tail" | "history" | "rebuild";
    invalidatedBy: readonly Mutation["kind"][];
  }>;

const PROJECTION_STAGE_ARTIFACTS = {
  activation: "activation",
  node: "storedNodes",
  configuration: "metanodes",
  occurrence: "authoredStructure",
  content: "contentNodes",
  owner: "nodeOwners",
  "node-graph": "nodeGraphStructure",
  "supertag-relations": "supertagRelations",
  "field-definition": "fieldDefinitionConfigurations",
  search: "searchClauses",
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
  const Invalidations extends readonly Mutation["kind"][],
>(definition: {
  key: Key;
  dependencies: Dependencies;
  factScope: "tail" | "history" | "rebuild";
  invalidatedBy: Invalidations;
  evaluate(
    context: ProjectionRuleContext<Key, Dependencies>,
  ): Pick<ProjectionPlanContext, ProjectionStageArtifact[Key]>;
}): ProjectionRule & Readonly<{ invalidatedBy: Invalidations }> {
  const writes = [PROJECTION_STAGE_ARTIFACTS[definition.key]] as const;
  return {
    key: definition.key,
    dependencies: definition.dependencies,
    factScope: definition.factScope,
    invalidatedBy: definition.invalidatedBy,
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

export type ProjectionReplayPolicy = Readonly<{
  replayAllActive: boolean;
  requiresAllActive: boolean;
}>;

export function projectionReplayPolicyFor(
  rules: readonly ProjectionRule[],
): (selected: ReadonlySet<ProjectionStageKey>) => ProjectionReplayPolicy {
  return (selected) => {
    const selectedRules = rules.filter((rule) => selected.has(rule.key));
    const replayAllActive = selectedRules.some((rule) => rule.factScope === "rebuild");
    return {
      replayAllActive,
      requiresAllActive: replayAllActive || selectedRules.some((rule) => rule.factScope === "history"),
    };
  };
}

type CompleteInvalidation<Rules extends readonly ProjectionRule[]> =
  Exclude<Mutation["kind"], Rules[number]["invalidatedBy"][number]> extends never ? unknown : never;

export function projectionInvalidationFor<const Rules extends readonly ProjectionRule[]>(
  rules: Rules & CompleteInvalidation<Rules>,
): (facts: readonly Fact[]) => ReadonlySet<ProjectionStageKey> {
  return (facts) => {
    const invalidated = new Set<ProjectionStageKey>();
    for (const fact of facts) {
      if (fact.body.kind !== "contribution" || fact.body.intent === "proposal") {
        for (const rule of rules) {
          invalidated.add(rule.key);
        }
        continue;
      }
      const mutationKind = fact.body.mutation.kind;
      const owners = rules.filter((rule) => rule.invalidatedBy.includes(mutationKind));
      if (owners.length === 0) {
        throw new Error(`Mutation ${mutationKind} has no Projection invalidation owner`);
      }
      for (const owner of owners) {
        invalidated.add(owner.key);
      }
    }
    return invalidated;
  };
}
