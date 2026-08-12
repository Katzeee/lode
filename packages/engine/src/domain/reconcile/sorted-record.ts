import { stableStringCompare } from "../fact/index.js";

export function sortedRecord<T>(values: ReadonlyMap<string, T>): Readonly<Record<string, T>> {
  return Object.fromEntries(
    [...values].sort(([left], [right]) => stableStringCompare(left, right)),
  );
}
