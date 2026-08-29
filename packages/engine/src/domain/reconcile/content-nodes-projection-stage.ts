import { cloneNodes } from "./node-state.js";
import { applyContent } from "./projection-content.js";
import { projectionStage } from "./projection-stage.js";

export const contentNodesProjectionStage = projectionStage({
  key: "contentNodes",
  dependencies: ["activation", "storedNodes"],
  project(context) {
    const contentNodes = cloneNodes(context.storedNodes);
    applyContent(context.activation.actions, contentNodes);
    return contentNodes;
  },
});
