import type { FactFrontier, ViewMode } from "../fact/index.js";

export const VIEW_SCHEMA_PROPERTY = "view.schemaId";
export const VIEW_LAYOUT_PROPERTY = "view.layout";
export const VIEW_FIELDS_PROPERTY = "view.fieldDefinitionIds";
export const MAX_VIEW_FIELDS = 20;

export type ViewLayout = "table" | "cards" | "calendar";

export type ViewDefinition = Readonly<{
  schemaId: string;
  layout: ViewLayout;
  fieldDefinitionIds: readonly string[];
}>;

export type ViewFieldCell = Readonly<{
  fieldDefinitionId: string;
  state: "absent" | "placeholder" | "materialized";
  fieldNodeId: string | null;
  fieldOccurrenceId: string | null;
  valueOccurrenceIds: readonly string[];
  valueNodeIds: readonly string[];
}>;

export type ViewRow = Readonly<{
  nodeId: string;
  text: string;
  fields: readonly ViewFieldCell[];
}>;

export type ViewResult = Readonly<{
  generationId: string;
  frontier: FactFrontier;
  view: ViewMode;
  viewNodeId: string;
  schemaId: string;
  layout: ViewLayout;
  fieldDefinitionIds: readonly string[];
  rows: readonly ViewRow[];
  next: string | null;
}>;
