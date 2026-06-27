// Pure value-type leaf: schema operation result shapes. No engine/domain-op imports.
import type { DomainChange } from "./changes.js";

export type SchemaIdentity = {
  nodeId: string;
  occurrenceId: string;
};

export type SchemaChangeResult = {
  target: SchemaIdentity;
  schema?: { nodeId: string };
  changes: DomainChange[];
};
