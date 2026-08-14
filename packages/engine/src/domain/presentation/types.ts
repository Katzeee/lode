import type { NodeType } from "../fact/index.js";

export type NodePresentation = Readonly<{
  nodeId: string;
  occurrenceId: string;
  occurrence: Readonly<{ kind: "original" | "reference" }>;
  nodeType: NodeType | null;
  content: Readonly<{ kind: "text"; text: string }>;
  fieldOccurrence: Readonly<{
    ownerNodeId: string;
    fieldDefinitionId: string;
  }> | null;
}>;
