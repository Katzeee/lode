import type { SequenceAnchor } from "./types.js";

export type InlineReferenceId = string;

export type InlineReferenceMutation =
  | Readonly<{
      kind: "inline-reference-create";
      inlineReferenceId: InlineReferenceId;
      hostNodeId: string;
      targetNodeId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "inline-reference-delete";
      inlineReferenceId: InlineReferenceId;
      previousHostNodeId?: string;
      previousTargetNodeId?: string;
      previousAnchor?: SequenceAnchor;
    }>
  | Readonly<{
      kind: "inline-reference-alias-attach";
      inlineReferenceId: InlineReferenceId;
      aliasNodeId: string;
    }>
  | Readonly<{
      kind: "inline-reference-alias-detach";
      inlineReferenceId: InlineReferenceId;
      aliasNodeId: string;
    }>;
