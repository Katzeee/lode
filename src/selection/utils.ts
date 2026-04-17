import type { Delta } from "../types.js";
import { getAttributeAtOffset } from "../delta/utils.js";

export function buildCombo(
  key: string,
  modifiers: { ctrl: boolean; meta: boolean; shift: boolean; alt: boolean },
  platform?: "mac" | "other",
): string {
  const isMac = platform === "mac";
  const parts: string[] = [];
  if (isMac && modifiers.meta) parts.push("Mod");
  else if (!isMac && modifiers.ctrl) parts.push("Mod");
  if (isMac && modifiers.ctrl) parts.push("Ctrl");
  if (!isMac && modifiers.meta) parts.push("Meta");
  if (modifiers.alt) parts.push("Alt");
  if (modifiers.shift) parts.push("Shift");
  parts.push(key);
  return parts.join("-");
}

export function getAttributesAtOffset(deltas: Delta, offset: number): Record<string, unknown> {
  let pos = 0;
  for (const span of deltas) {
    const spanEnd = pos + span.insert.length;
    if (offset >= pos && offset < spanEnd) {
      return span.attributes ? { ...span.attributes } : {};
    }
    pos = spanEnd;
  }
  // Cursor at end of last span: inherit from previous char
  if (offset > 0 && deltas.length > 0) {
    const last = deltas[deltas.length - 1];
    return last.attributes ? { ...last.attributes } : {};
  }
  return {};
}

// Re-export from delta/utils for selection consumers
export { getAttributeAtOffset };
