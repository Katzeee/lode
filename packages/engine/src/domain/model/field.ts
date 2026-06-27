// Pure value-type leaf: field operation input/result shapes. No engine/domain-op imports.
import type { DomainChange } from "./changes.js";

export type FieldAddMode = "reuseExisting" | "createOnly";

export type FieldValueInput =
  | { type: "text"; text: string }
  | { type: "ref"; targetNodeId: string }
  | { type: "move"; occurrenceId: string };

export type FieldIdentity = {
  nodeId: string;
  occurrenceId: string;
};

export type FieldAddResult = FieldIdentity & {
  created: boolean;
};

export type FieldSetValuesResult = {
  field: FieldIdentity;
  changes: DomainChange[];
};
