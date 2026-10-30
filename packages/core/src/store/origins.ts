// Purpose: Defines commit origins that separate undoable commands from persistent system writes.

/**
 * Commit origins. The undo manager skips every origin under `EXCLUDED`: allocation, so undoing a
 * command never removes a node's creation facts; the seeding of a copy's name text from its base, so
 * undoing the first edit returns the name to its base; and history writes such as the Trash
 * occurrences an Undo ensures, so Redo keeps them.
 */
export const EXCLUDED = "sys:";

export const GENESIS = `${EXCLUDED}genesis`;
export const ALLOCATION = `${EXCLUDED}allocation`;
export const NAME_SEED = `${EXCLUDED}name-seed`;
export const HISTORY = `${EXCLUDED}history`;

/** A command's own writes: one undo step. */
export const COMMAND = "command";
