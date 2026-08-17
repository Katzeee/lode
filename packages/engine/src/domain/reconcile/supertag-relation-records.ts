import { stableStringCompare } from "../fact/index.js";
import type { MaterializedField } from "./projection-types.js";

export function materializedFieldRecord(
  values: ReadonlyMap<string, readonly MaterializedField[]>,
): Readonly<Record<string, readonly MaterializedField[]>> {
  return Object.fromEntries(
    [...values].filter(([, entries]) => entries.length > 0).sort(([left], [right]) => stableStringCompare(left, right)),
  );
}

export function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

export function relationRecord(
  values: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    [...values].filter(([, entries]) => entries.length > 0).sort(([left], [right]) => stableStringCompare(left, right)),
  );
}
