// Purpose: Derives the fixed identities of a workspace's system nodes from its document id.

import type { DocId } from "../store/doc-id.ts";
import type { NodeId } from "../store/node-id.ts";

/**
 * System roles are identities, not kinds. Containers hold the outline, deleted originals and
 * definitions; the definition roles mark supertags, field definitions and option fields, carry a
 * node's tags, are every metanode's template, and stand for the system empty value a projected
 * empty field shows.
 */
export const SYSTEM_ROLES = [
  "root",
  "home",
  "trash",
  "schema",
  "supertag",
  "fieldDefinition",
  "options",
  "tags",
  "metaTemplate",
  "emptyValue",
] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

export type SystemNodes = Readonly<Record<SystemRole, NodeId>>;

/** Keyed by document, so two workspaces, or two parts of one, never share a system node. */
export function systemNodes(docId: DocId): SystemNodes {
  return Object.fromEntries(SYSTEM_ROLES.map((role) => [role, `${docId}:${role}`])) as Record<SystemRole, NodeId>;
}
