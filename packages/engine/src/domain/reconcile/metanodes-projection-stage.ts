import { projectMetanodes } from "./metanodes.js";
import { projectionStage } from "./projection-stage.js";

export const metanodesProjectionStage = projectionStage({
  key: "metanodes",
  dependencies: ["activation", "storedNodes"],
  project: (context) => projectMetanodes(context.activation.actions, new Set(context.storedNodes.keys())),
});
