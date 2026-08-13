import type { JsonValue } from "./types.js";

export type NodeSeed = Readonly<{
  text: readonly Readonly<{
    value: string;
    attributes: Readonly<Record<string, JsonValue>>;
  }>[];
  properties: Readonly<Record<string, JsonValue>>;
  metadata: Readonly<Record<string, JsonValue>>;
}>;

export const EMPTY_NODE_SEED: NodeSeed = {
  text: [],
  properties: {},
  metadata: {},
};
