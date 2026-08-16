import type { JsonValue } from "./types.js";

export type NodeSeed = Readonly<{
  text: readonly Readonly<{
    value: string;
    attributes: Readonly<Record<string, JsonValue>>;
  }>[];
}>;
