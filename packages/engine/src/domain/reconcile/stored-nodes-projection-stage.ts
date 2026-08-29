import { createNodes } from "./node-state.js";
import { projectionStage } from "./projection-stage.js";

export const storedNodesProjectionStage = projectionStage({
  key: "storedNodes",
  dependencies: ["activation"],
  project: (context) => createNodes(context.activation.actions),
});
