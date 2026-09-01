import type { JsonValue, SequenceAnchor } from "./fact-value-types.js";

export type NodeSeed = Readonly<{
  text: readonly Readonly<{
    value: string;
    attributes: Readonly<Record<string, JsonValue>>;
  }>[];
}>;

export type OriginalPlacement = Readonly<{
  placementId: string;
  anchor: SequenceAnchor;
}>;
