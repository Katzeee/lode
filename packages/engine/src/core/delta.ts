import type { Delta } from "./types.js";

export function deltaToText(deltas: Delta): string {
  let s = "";
  for (const span of deltas) {
    s += span.insert;
  }
  return s;
}

export function textToDelta(text: string): Delta {
  return text.length === 0 ? [] : [{ insert: text }];
}
