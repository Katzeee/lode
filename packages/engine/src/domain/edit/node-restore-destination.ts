import { exact, nonempty, object, ShapeValidationError } from "../../decoding/index.js";
import { editField } from "./edit-definition.js";

export type NodeRestoreDestination =
  | Readonly<{ kind: "node"; nodeId: string }>
  | Readonly<{ kind: "field"; ownerNodeId: string; fieldDefinitionId: string }>;

export const nodeRestoreDestinationField = editField<NodeRestoreDestination>(
  "Node restoration destination",
  { kind: "message", message: "NodeRestoreDestination" },
  (input) => {
    const destination = object(input, "Node restoration destination");
    if (destination.kind === "node") {
      exact(destination, ["kind", "nodeId"], "Node restoration destination");
      return { kind: "node", nodeId: nonempty(destination.nodeId, "Destination Node identity") };
    }
    if (destination.kind === "field") {
      exact(destination, ["kind", "ownerNodeId", "fieldDefinitionId"], "Field restoration destination");
      return {
        kind: "field",
        ownerNodeId: nonempty(destination.ownerNodeId, "Field owner identity"),
        fieldDefinitionId: nonempty(destination.fieldDefinitionId, "Field Definition identity"),
      };
    }
    throw new ShapeValidationError("Unsupported Node restoration destination");
  },
);
