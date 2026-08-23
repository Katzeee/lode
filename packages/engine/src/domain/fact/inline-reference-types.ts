import type { SequenceAnchor } from "./types.js";

export type InlineReferenceId = string;

export type InlineReferenceAction =
  | Readonly<{
      kind: "inline-reference-create";
      inlineReferenceId: InlineReferenceId;
      hostNodeId: string;
      targetNodeId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "inline-reference-remove";
      inlineReferenceId: InlineReferenceId;
    }>
  | Readonly<{
      kind: "inline-alias-attach";
      inlineReferenceId: InlineReferenceId;
      aliasNodeId: string;
    }>
  | Readonly<{
      kind: "inline-alias-detach";
      inlineReferenceId: InlineReferenceId;
      aliasNodeId: string;
    }>;
