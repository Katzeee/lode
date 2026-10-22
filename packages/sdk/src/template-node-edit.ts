import type {
  TemplateNodeEditAction,
  NodeContentEditIntent,
  NodeSupertagEditIntent,
  NodeInsertionEditIntent,
  NodeContentInput as ProtocolNodeContentInput,
  TextSegmentSeed,
  InlineReferenceInput,
} from "@lode/protocol/proto";
import type { ProtocolDto, WithKind } from "./protocol-dto.js";

export type NodeContentInput = Omit<ProtocolDto<ProtocolNodeContentInput>, "items"> &
  Readonly<{
    items: readonly (
      | WithKind<TextSegmentSeed, "text">
      | (Omit<WithKind<InlineReferenceInput, "inline-reference">, "alias" | "sourceReferenceId"> &
          Readonly<{ alias?: NodeContentInput; sourceReferenceId?: string }>)
    )[];
  }>;
export type TemplateNodeEdit = Omit<WithKind<TemplateNodeEditAction, "template-node-edit">, "intents"> &
  Readonly<{ intents: readonly NodeEditIntent[] }>;

export type NodeEditIntent =
  | (Omit<WithKind<NodeContentEditIntent, "set-content">, "content"> & Readonly<{ content: NodeContentInput }>)
  | (Omit<WithKind<NodeInsertionEditIntent, "insert-node">, "content" | "placement"> &
      Readonly<{ content: NodeContentInput; placement: "before" | "after" | "child" }>)
  | WithKind<NodeSupertagEditIntent, "add-supertag">
  | WithKind<NodeSupertagEditIntent, "remove-supertag">;
