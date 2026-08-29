import type { AcceptedEngineCommand } from "../application/input-validation.js";
import type { BoundWorkspaceCommand } from "./command-rule.js";
import { bindDeletionFinalizationCommand } from "./deletion-finalization.js";
import { bindEditCommand } from "./edit-command.js";
import { bindHistoryCommand } from "./history-command.js";
import { bindReviewCommand } from "./review-command.js";

export function bindWorkspaceCommand(command: AcceptedEngineCommand): BoundWorkspaceCommand {
  switch (command.kind) {
    case "edit":
      return bindEditCommand(command);
    case "resolve-review":
    case "adjudicate-resolution":
      return bindReviewCommand(command);
    case "undo":
    case "redo":
      return bindHistoryCommand(command);
    case "finalize-deletions":
      return bindDeletionFinalizationCommand(command);
    default:
      return assertNever(command);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Workspace command: ${JSON.stringify(value)}`);
}
