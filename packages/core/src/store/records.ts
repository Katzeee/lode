// Purpose: Reads and writes a node's facts and per-peer support and real records in the root map shared by its incarnations.

import type { Delta, LoroMap, PeerID } from "loro-crdt";
import { peerOf, type CommandId } from "./command-id.ts";
import type { NodeId } from "./node-id.ts";
import type { Store } from "./store.ts";

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

const KIND = "kind";
const TUPLE_DEFINITION_ID = "tupleDefinitionId";
const SOURCE = "sourceId";
const DESCRIPTION = "description";
const NAME_BASE = "nameBase";
const NAME_SEEDED = "nameSeeded";
const SUPPORT = "sup|";
const REAL = "real|";

/**
 * The root map `node:<id>`, shared by every incarnation of the node, so concurrent creations of one
 * NodeId read one set of facts. Undefined for an id this replica never allocated: reading a root
 * container that was never written would add an empty one to this replica's snapshot.
 */
export function factsOf(store: Store, id: NodeId): LoroMap | undefined {
  return store.has(id) ? store.doc.getMap(`node:${id}`) : undefined;
}

/** The facts map for a write; writes may precede the commit that indexes a new node. */
export function writableFacts(store: Store, id: NodeId): LoroMap {
  return store.doc.getMap(`node:${id}`);
}

export function kindOf(store: Store, id: NodeId): Kind | undefined {
  return factsOf(store, id)?.get(KIND) as Kind | undefined;
}

export function tupleDefinitionIdOf(store: Store, id: NodeId): NodeId | undefined {
  return factsOf(store, id)?.get(TUPLE_DEFINITION_ID) as NodeId | undefined;
}

export function sourceOf(store: Store, id: NodeId): NodeId | undefined {
  return factsOf(store, id)?.get(SOURCE) as NodeId | undefined;
}

export function descriptionOf(store: Store, id: NodeId): string | undefined {
  return factsOf(store, id)?.get(DESCRIPTION) as string | undefined;
}

/** The copied name a derived copy reads until its text is first written, marks included. */
export function nameBaseOf(store: Store, id: NodeId): Delta<string>[] | undefined {
  return factsOf(store, id)?.get(NAME_BASE) as Delta<string>[] | undefined;
}

/** Whether the name text has been seeded from `nameBase`; from then on the text is the name. */
export function isNameSeeded(store: Store, id: NodeId): boolean {
  return factsOf(store, id)?.get(NAME_SEEDED) === true;
}

/** Each peer's latest supporting command. Only the owning peer writes its key. */
export function supportsOf(store: Store, id: NodeId): Map<PeerID, CommandId> {
  const supports = new Map<PeerID, CommandId>();
  for (const [key, value] of Object.entries((factsOf(store, id)?.toJSON() ?? {}) as Record<string, unknown>)) {
    if (key.startsWith(SUPPORT)) {
      supports.set(key.slice(SUPPORT.length) as PeerID, value as CommandId);
    }
  }
  return supports;
}

export function hasSupport(store: Store, id: NodeId): boolean {
  return (factsOf(store, id)?.keys() as string[] | undefined)?.some((key) => key.startsWith(SUPPORT)) ?? false;
}

/**
 * Whether the node reads real: some peer stored its read state while it was not present. Each peer
 * keeps its own key, because one cleared value would let one replica's Undo restore the creation facts
 * over another replica's make-real that still keeps the node present.
 */
export function readsReal(store: Store, id: NodeId): boolean {
  return (factsOf(store, id)?.keys() as string[] | undefined)?.some((key) => key.startsWith(REAL)) ?? false;
}

/**
 * Records `peer`'s contribution to the node reading real. The value never changes, so writing a key
 * that is already there is no Loro operation and leaves the key with the command that wrote it.
 */
export function writeReal(store: Store, id: NodeId, peer: PeerID): void {
  writableFacts(store, id).set(REAL + peer, true);
}

/** The facts a node is created with; they are written once, in the allocation commit. */
export type CreationFacts = {
  id: NodeId;
  kind?: Kind;
  tupleDefinitionId?: NodeId;
  sourceId?: NodeId;
  nameBase?: Delta<string>[];
};

/**
 * Writes what a creation establishes and nothing else: a concurrent creation of the same NodeId writes
 * equal facts, and neither ever clears a fact the other's later write set, nor the seeding marker.
 */
export function writeCreationFacts(store: Store, facts: CreationFacts): void {
  const map = writableFacts(store, facts.id);
  for (const [key, value] of [
    [KIND, facts.kind],
    [TUPLE_DEFINITION_ID, facts.tupleDefinitionId],
    [SOURCE, facts.sourceId],
    [NAME_BASE, facts.nameBase],
  ] as const) {
    if (value !== undefined) {
      map.set(key, value);
    }
  }
}

export function writeKind(store: Store, id: NodeId, kind: Kind | undefined): void {
  writeOptional(store, id, KIND, kind);
}

export function writeTupleDefinitionId(store: Store, id: NodeId, tupleDefinitionId: NodeId | undefined): void {
  writeOptional(store, id, TUPLE_DEFINITION_ID, tupleDefinitionId);
}

export function writeDescription(store: Store, id: NodeId, description: string | undefined): void {
  writeOptional(store, id, DESCRIPTION, description || undefined);
}

export function writeNameSeeded(store: Store, id: NodeId): void {
  writableFacts(store, id).set(NAME_SEEDED, true);
}

/**
 * Records that `command` supports the node. Rewriting the value a key already holds is no Loro
 * operation, so a command counts only through its own id.
 */
export function writeSupport(store: Store, id: NodeId, command: CommandId): void {
  writableFacts(store, id).set(SUPPORT + peerOf(command), command);
}

function writeOptional(store: Store, id: NodeId, key: string, value: string | undefined): void {
  const map = writableFacts(store, id);
  if (value === undefined) {
    map.delete(key);
  } else {
    map.set(key, value);
  }
}
