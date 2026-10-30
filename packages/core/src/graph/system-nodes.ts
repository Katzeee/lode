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

/** The workspace's containers: they live in the workspace itself, like any outline node. */
const CONTAINER_ROLES: readonly SystemRole[] = ["root", "home", "trash", "schema"];

/**
 * A system node in the reference system's sense: a definition role, or a node genesis derives from one
 * (its metanode and tag application, `<role id>:…`). The reference system keeps these in a separate
 * system file; the workspace's containers are not among them.
 */
export function isSystemNode(system: SystemNodes, id: NodeId): boolean {
  return SYSTEM_ROLES.some(
    (role) => !CONTAINER_ROLES.includes(role) && (id === system[role] || id.startsWith(`${system[role]}:`)),
  );
}
