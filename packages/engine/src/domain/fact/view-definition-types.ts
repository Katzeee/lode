import type { FactId } from "./types.js";
import type { ViewOptionsSpec } from "./view-options-spec.js";

export type ViewType = "outline" | "table";

export type SharedDefaultViewDefinitionAttachMutation = Readonly<{
  kind: "shared-default-view-definition-attach";
  hostNodeId: string;
  attachmentNodeId: string;
  attachmentOccurrenceId: string;
  relationDefinitionOccurrenceId: string;
  viewDefinitionNodeId: string;
  viewDefinitionOccurrenceId: string;
}>;

export type SharedDefaultViewDefinitionDetachMutation = Readonly<{
  kind: "shared-default-view-definition-detach";
  hostNodeId: string;
  attachmentNodeId: string;
  attachmentOccurrenceId: string;
  relationDefinitionOccurrenceId: string;
  viewDefinitionNodeId: string;
  viewDefinitionOccurrenceId: string;
  detachedValueNodeId: string;
  detachedValueOccurrenceId: string;
}>;

export type SharedDefaultViewDefinitionModeSetMutation = Readonly<{
  kind: "shared-default-view-definition-mode-set";
  viewDefinitionNodeId: string;
  viewType: ViewType;
  previousViewType?: ViewType | null;
  observedModeFactIds?: readonly FactId[];
}>;

export type SharedDefaultViewDefinitionSortByNameSetMutation = Readonly<{
  kind: "shared-default-view-definition-sort-by-name-set";
  hostNodeId: string;
  viewDefinitionNodeId: string;
  sortOrderFieldNodeId: string;
  sortOrderFieldOccurrenceId: string;
  sortFieldNodeId: string;
  sortFieldOccurrenceId: string;
  nodeNameOccurrenceId: string;
  ascendingOccurrenceId: string;
  enabled: boolean;
  previousEnabled: boolean;
}>;

export type SharedDefaultViewDefinitionOptionsSetMutation = Readonly<{
  kind: "shared-default-view-definition-options-set";
  hostNodeId: string;
  viewDefinitionNodeId: string;
  options: ViewOptionsSpec;
  previousOptions?: ViewOptionsSpec;
  observedOptionsFactIds?: readonly FactId[];
}>;
