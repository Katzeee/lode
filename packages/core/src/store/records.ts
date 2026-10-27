// Purpose: Reads and writes node attributes, owner listings and peer support records.

import { LoroText, type LoroTreeNode, type PeerID } from "loro-crdt";
import { peerOf, type CommandId } from "./command-id.ts";
import type { NodeId } from "./node-id.ts";

/**
 * Nominal node kinds: storage preserves every kind even when no operation creates it yet;
 * a contextual role such as supertag is never a kind.
 */
export const KINDS = [
  "chat",
  "tuple",
  "workspace",
  "viewDef",
  "associatedData",
  "placeholder",
  "hotkey",
  "codeblock",
  "code",
  "search",
  "url",
  "command",
  "chatbot",
  "mcpServer",
  "transcript",
  "transcriptLine",
  "extension",
  "visual",
  "recording",
  "settingsSection",
  "journal",
  "journalPart",
  "settings",
  "tagDef",
  "attrDef",
  "metanode",
  "group",
  "home",
  "syntax",
  "stackFrame",
  "aiMessage",
  "aiConversation",
  "systemTool",
  "markdown",
] as const;

export type Kind = (typeof KINDS)[number];

const ID = "id";
const REF = "ref";
const KIND = "kind";
const TUPLE_DEFINITION_ID = "tupleDefinitionId";
const SOURCE = "sourceId";
const NAME = "name";
const DESCRIPTION = "description";
const LIST = "list|";
const SUPPORT = "sup|";

export function idOf(node: LoroTreeNode): NodeId | undefined {
  return node.data.get(ID) as NodeId | undefined;
}

/** A reference leaf's target; undefined for a node with an identity. */
export function refOf(node: LoroTreeNode): NodeId | undefined {
  return node.data.get(REF) as NodeId | undefined;
}

export function kindOf(node: LoroTreeNode): Kind | undefined {
  return node.data.get(KIND) as Kind | undefined;
}

export function tupleDefinitionIdOf(node: LoroTreeNode): NodeId | undefined {
  return node.data.get(TUPLE_DEFINITION_ID) as NodeId | undefined;
}

export function sourceOf(node: LoroTreeNode): NodeId | undefined {
  return node.data.get(SOURCE) as NodeId | undefined;
}

export function descriptionOf(node: LoroTreeNode): string | undefined {
  return node.data.get(DESCRIPTION) as string | undefined;
}

export function nameOf(node: LoroTreeNode): LoroText {
  return node.data.get(NAME) as LoroText;
}

/**
 * Whether `owner` lists the node through its own key. One key per owner: when Loro refuses a cyclic
 * move, the node falls back to its old parent, whose key the refused move never touched.
 */
export function listedBy(node: LoroTreeNode, owner: NodeId): boolean {
  return node.data.get(LIST + owner) === true;
}

/** Each peer's latest supporting command. Only the owning peer writes its key. */
export function supportsOf(node: LoroTreeNode): Map<PeerID, CommandId> {
  const supports = new Map<PeerID, CommandId>();
  for (const [key, value] of Object.entries(node.data.toJSON() as Record<string, unknown>)) {
    if (key.startsWith(SUPPORT)) {
      supports.set(key.slice(SUPPORT.length) as PeerID, value as CommandId);
    }
  }
  return supports;
}

/** The facts a node is created with; they are written once, in the allocation commit. */
export type CreationFacts = {
  id: NodeId;
  kind?: Kind;
  tupleDefinitionId?: NodeId;
  sourceId?: NodeId;
};

export function writeCreationFacts(node: LoroTreeNode, facts: CreationFacts): void {
  node.data.set(ID, facts.id);
  node.data.setContainer(NAME, new LoroText());
  writeOptional(node, KIND, facts.kind);
  writeOptional(node, TUPLE_DEFINITION_ID, facts.tupleDefinitionId);
  writeOptional(node, SOURCE, facts.sourceId);
}

export function writeKind(node: LoroTreeNode, kind: Kind | undefined): void {
  writeOptional(node, KIND, kind);
}

export function writeTupleDefinitionId(node: LoroTreeNode, tupleDefinitionId: NodeId | undefined): void {
  writeOptional(node, TUPLE_DEFINITION_ID, tupleDefinitionId);
}

export function writeDescription(node: LoroTreeNode, description: string | undefined): void {
  writeOptional(node, DESCRIPTION, description || undefined);
}

export function writeListed(node: LoroTreeNode, owner: NodeId, listed: boolean): void {
  node.data.set(LIST + owner, listed);
}

/**
 * Records that `command` supports the node. Rewriting the value a key already holds is no Loro
 * operation, so a command counts only through its own id.
 */
export function writeSupport(node: LoroTreeNode, command: CommandId): void {
  node.data.set(SUPPORT + peerOf(command), command);
}

export function writeRef(leaf: LoroTreeNode, target: NodeId): void {
  leaf.data.set(REF, target);
}

function writeOptional(node: LoroTreeNode, key: string, value: string | undefined): void {
  if (value === undefined) {
    node.data.delete(key);
  } else {
    node.data.set(key, value);
  }
}
