import type { FactId } from "./types.js";

export type ViewType = "outline" | "table";

export type SharedDefaultViewDefinitionAttachMutation = Readonly<{
  kind: "shared-default-view-definition-attach";
  hostNodeId: string;
  viewDefinitionNodeId: string;
  viewDefinitionOccurrenceId: string;
}>;

export type SharedDefaultViewDefinitionModeSetMutation = Readonly<{
  kind: "shared-default-view-definition-mode-set";
  viewDefinitionNodeId: string;
  viewType: ViewType;
  previousViewType?: ViewType | null;
  observedModeFactIds?: readonly FactId[];
}>;
