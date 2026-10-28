// Purpose: Bundles the store and system identities that every graph read needs.

import type { Store } from "../store/store.ts";
import type { SystemNodes } from "./system-nodes.ts";

/** What a graph read runs against: one replica's storage and its workspace's system nodes. */
export type Graph = { readonly store: Store; readonly system: SystemNodes };
