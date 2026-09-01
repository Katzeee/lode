import {
  actionHasEditAccess,
  type AuthoredAction,
  type GraphAction,
  type GraphActionKindWithEditAccess,
} from "../fact/index.js";
import type { RegistryEditAction } from "./edit-catalog.js";

type DirectAuthoredActionEdit = Extract<GraphAction, { kind: GraphActionKindWithEditAccess<"direct"> }>;

export type EditAction = DirectAuthoredActionEdit | RegistryEditAction;

export type ConfigureFieldDefinitionEdit = Extract<
  EditAction,
  {
    kind:
      | "field-datatype-configure"
      | "field-cardinality-configure"
      | "field-optionality-configure"
      | "field-initialization-expression-configure";
  }
>;

type ExpandableEdit = DirectAuthoredActionEdit | Extract<RegistryEditAction, { kind: "node-create" }>;

export function isDirectAuthoredActionEdit(action: AuthoredAction): action is DirectAuthoredActionEdit {
  return actionHasEditAccess(action, "direct");
}

export function expandEditAction(edit: ExpandableEdit): readonly [GraphAction, ...GraphAction[]] {
  if (edit.kind !== "node-create") {
    return [edit];
  }
  const { occurrenceId, parentNodeId, anchor, ...node } = edit;
  return [
    {
      ...node,
      ownerNodeId: parentNodeId,
      originalPlacement: { placementId: occurrenceId, anchor },
    },
  ];
}
