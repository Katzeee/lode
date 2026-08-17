import type { NodeSeed, SequenceAnchor } from "../fact/index.js";

export type DebugNodeOpenEdit = Readonly<{
  kind: "debug-node-open";
  hostNodeId: string;
  metanodeId: string;
}>;

export type FieldValueCreateEdit = Readonly<{
  kind: "field-value-create";
  ownerNodeId: string;
  fieldDefinitionId: string;
  fieldNodeId: string;
  fieldOccurrenceId: string;
  valueNodeId: string;
  valueOccurrenceId: string;
  anchor: SequenceAnchor;
  seed?: NodeSeed;
}>;

export type UrlNodeCreateEdit = Readonly<{
  kind: "url-node-create";
  nodeId: string;
  occurrenceId: string;
  parentNodeId: string;
  anchor: SequenceAnchor;
  seed?: NodeSeed;
  urlFieldNodeId: string;
  urlFieldOccurrenceId: string;
  urlValueNodeId: string;
  urlValueOccurrenceId: string;
  url: string;
}>;

export type CodeNodeConfigureEdit = Readonly<{
  kind: "code-node-configure";
  nodeId: string;
  languageFieldNodeId: string;
  languageFieldOccurrenceId: string;
  languageValueNodeId: string;
  languageValueOccurrenceId: string;
  language: string;
}>;

export type SharedDefaultViewDefinitionSortByNameCreateEdit = Readonly<{
  kind: "shared-default-view-definition-sort-by-name-create";
  hostNodeId: string;
  viewDefinitionNodeId: string;
  sortOrderFieldNodeId: string;
  sortOrderFieldOccurrenceId: string;
  sortFieldNodeId: string;
  sortFieldOccurrenceId: string;
  nodeNameOccurrenceId: string;
  ascendingOccurrenceId: string;
}>;
