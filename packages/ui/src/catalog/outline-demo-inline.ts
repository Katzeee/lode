import type { OutlineContent, OutlineToken } from "../components/outline/outline-content.js";
import { outlineFormatting } from "../components/outline/outline-formatting.js";
import { parseOutlineContent, type OutlineSourceSpan } from "../components/outline/outline-inline-extension.js";

export const demoInlineIds = { reference: "node-reference", supertag: "supertag" } as const;

export function demoInlineToken(kind: keyof typeof demoInlineIds, id: string, label: string): OutlineToken {
  const escaped = label.replaceAll("\\", "\\\\").replaceAll("}", "\\}");
  return {
    data: { id },
    extension: demoInlineIds[kind],
    label: kind === "supertag" ? `#${label}` : label,
    source: `${kind === "supertag" ? "#" : "@"}{${escaped}}`,
    type: "token",
  };
}

export function demoTokenTarget(token: OutlineToken): string | null {
  const data = token.data;
  return typeof data === "object" && data !== null && "id" in data && typeof data.id === "string" ? data.id : null;
}

export function demoNodeLabel(content: OutlineContent): string {
  const spans = parseOutlineContent(
    content.filter((inline) => inline.type !== "token" || inline.extension !== demoInlineIds.supertag),
    outlineFormatting,
  );
  const text = (span: OutlineSourceSpan): string => span.children?.map(text).join("") ?? span.text;
  return spans.map(text).join("").trimEnd();
}
