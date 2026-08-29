import { projectionStage } from "./projection-stage.js";
import { createOccurrences } from "./projection-state.js";

export const authoredStructureProjectionStage = projectionStage({
  key: "authoredStructure",
  dependencies: ["activation", "storedNodes"],
  project: (context) => createOccurrences(context.workspaceNodeId, context.activation.actions, context.storedNodes),
});
