// Purpose: Identifies commands by peer and operation counter across replicas and restarts.

import type { LoroDoc, PeerID } from "loro-crdt";

/**
 * Names one command across replicas and restarts: its peer and the counter of its first Loro
 * operation. Loro continues a peer's counter from the history it has loaded, so a reused peer never
 * repeats an id; a process-local sequence would.
 */
export type CommandId = string & { readonly brand: "CommandId" };

/** The id the next command on `doc` gets. Call with no uncommitted writes pending. */
export function nextCommandId(doc: LoroDoc): CommandId {
  const peer = doc.peerIdStr;
  return `${peer}@${doc.oplogVersion().get(peer) ?? 0}` as CommandId;
}

export function peerOf(command: CommandId): PeerID {
  return command.slice(0, command.indexOf("@")) as PeerID;
}
