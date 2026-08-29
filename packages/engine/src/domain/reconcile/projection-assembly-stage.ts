import { projectionStage } from "./projection-stage.js";
import { assembleProjectionArtifacts } from "./projection-value-assembly.js";

export const projectionAssemblyStage = projectionStage({
  key: "projection",
  dependencies: [
    "activation",
    "storedNodes",
    "contentNodes",
    "nodeGraphStructure",
    "supertagRelations",
    "fieldDefinitionConfigurations",
    "searchExpressions",
    "sharedDefaultViewDefinitions",
    "conflictIssues",
    "templateStructure",
  ],
  project: (context) =>
    assembleProjectionArtifacts({
      ...context,
      active: context.activation.actions,
    }),
});
