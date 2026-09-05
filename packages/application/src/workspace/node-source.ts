import {
  outlineFormatting,
  parseOutlineContent,
  type OutlineContent,
  type OutlineSourceSpan,
  type OutlineToken,
} from "@lode/ui";
import type { JsonValue, ProjectedNode } from "@lode/sdk";
import type { WorkspaceSnapshot } from "./workspace-model.js";

export type ReferenceData = Readonly<{
  kind: "reference" | "supertag";
  targetNodeId: string;
  referenceId?: string;
  aliasNodeId?: string | null;
}>;
export type SourceEntry =
  | Readonly<{ kind: "text"; value: string; attributes: Readonly<Record<string, JsonValue>> }>
  | Readonly<{ kind: "reference"; data: ReferenceData }>;
export function referenceData(token: OutlineToken): ReferenceData | null {
  const data = token.data;
  return typeof data === "object" &&
    data !== null &&
    "kind" in data &&
    (data.kind === "reference" || data.kind === "supertag") &&
    "targetNodeId" in data &&
    typeof data.targetNodeId === "string" &&
    (!("referenceId" in data) || data.referenceId === undefined || typeof data.referenceId === "string") &&
    (!("aliasNodeId" in data) || data.aliasNodeId == null || typeof data.aliasNodeId === "string")
    ? (data as ReferenceData)
    : null;
}
export function referenceToken(data: ReferenceData, label: string): OutlineToken {
  const trigger = data.kind === "reference" ? "@" : "#";
  return {
    type: "token",
    extension: data.kind,
    label: data.kind === "supertag" ? `#${label}` : label,
    source: `${trigger}{${label.replaceAll("\\", "\\\\").replaceAll("}", "\\}")}}`,
    data,
  };
}
export function nodeLabel(
  node: ProjectedNode,
  graph: Pick<WorkspaceSnapshot, "nodes">,
  visited = new Set<string>(),
): string {
  if (visited.has(node.nodeId)) {
    return "…";
  }
  const next = new Set(visited).add(node.nodeId);
  return node.content
    .map((atom) => {
      if (atom.kind === "text") {
        return atom.value;
      }
      const target = graph.nodes[atom.aliasNodeId ?? atom.targetNodeId];
      return target ? nodeLabel(target, graph, next) : "Unavailable node";
    })
    .join("");
}
const delimiters = [
  ["bold", "**"],
  ["italic", "__"],
  ["code", "`"],
] as const;
const escapeText = (text: string) => text.replace(/[\\*_`@#]/gu, "\\$&");
export function nodeSource(node: ProjectedNode, graph: WorkspaceSnapshot): OutlineContent {
  const content: OutlineContent[number][] = [];
  let text = "";
  let attributes: Readonly<Record<string, JsonValue>> = {};
  const flush = () => {
    if (!text) {
      return;
    }
    let source =
      attributes.code === true ? text.replace(/[\\`]/gu, "\\let source = escapeText(text);") : escapeText(text);
    for (const [key, delimiter] of [...delimiters].reverse()) {
      if (attributes[key] === true) {
        source = delimiter + source + delimiter;
      }
    }
    content.push({ type: "text", text: source });
    text = "";
  };
  for (const atom of node.content) {
    if (atom.kind === "text") {
      if (delimiters.some(([key]) => attributes[key] !== atom.attributes[key])) {
        flush();
      }
      attributes = atom.attributes;
      text += atom.value;
    } else {
      flush();
      const target = graph.nodes[atom.aliasNodeId ?? atom.targetNodeId];
      content.push(
        referenceToken(
          { kind: "reference", referenceId: atom.id, targetNodeId: atom.targetNodeId, aliasNodeId: atom.aliasNodeId },
          target ? nodeLabel(target, graph) : "Unavailable node",
        ),
      );
    }
  }
  flush();
  for (const tag of graph.supertagApplications[node.nodeId] ?? []) {
    content.push(
      { type: "text", text: " " },
      referenceToken(
        { kind: "supertag", targetNodeId: tag.supertagId },
        graph.nodes[tag.supertagId] ? nodeLabel(graph.nodes[tag.supertagId]!, graph) : "Unavailable supertag",
      ),
    );
  }
  return content;
}
export function resolveSource(
  content: OutlineContent,
  base: ProjectedNode,
  graph: WorkspaceSnapshot,
  baseline: OutlineContent = nodeSource(base, graph),
): OutlineContent {
  const originals = baseline.filter((item): item is OutlineToken => item.type === "token");
  const used = new Set<OutlineToken>();
  const reserved = new Set(
    content.flatMap((item) =>
      item.type === "token" ? [referenceData(item)?.referenceId].filter((id): id is string => id !== undefined) : [],
    ),
  );
  return content.flatMap((inline): OutlineContent[number][] => {
    if (inline.type === "token") {
      const data = referenceData(inline);
      const original =
        data?.kind === "reference" && data.referenceId === undefined
          ? originals.find((candidate) => {
              const target = referenceData(candidate);
              return (
                !used.has(candidate) &&
                !reserved.has(target?.referenceId ?? "") &&
                target?.kind === "reference" &&
                target.targetNodeId === data.targetNodeId &&
                candidate.source === inline.source
              );
            })
          : undefined;
      if (original) {
        used.add(original);
        return [original];
      }
      return [inline];
    }
    const parts: OutlineContent[number][] = [];
    let position = 0;
    for (const match of inline.text.matchAll(/(?<!\\)([@#])\{((?:\\.|[^}\\])*)\}/gu)) {
      const label = match[2]!.replace(/\\([\\}])/gu, "$1");
      const original = originals.find((token) => token.source === match[0] && !used.has(token));
      const kind = match[1] === "@" ? "reference" : "supertag";
      const candidates = Object.values(graph.nodes).filter(
        (node) =>
          nodeLabel(node, graph) === label && (kind !== "supertag" || node.intrinsicNodeType === "supertag-definition"),
      );
      const token =
        original ??
        (candidates.length === 1 ? referenceToken({ kind, targetNodeId: candidates[0]!.nodeId }, label) : null);
      if (!token) {
        continue;
      }
      parts.push({ type: "text", text: inline.text.slice(position, match.index) }, token);
      if (original) {
        used.add(original);
      }
      position = match.index + match[0].length;
    }
    parts.push({ type: "text", text: inline.text.slice(position) });
    return parts;
  });
}
export function sourceEntries(
  content: OutlineContent,
): Readonly<{ entries: readonly SourceEntry[]; supertagIds: ReadonlySet<string> }> {
  const entries: SourceEntry[] = [];
  const supertagIds = new Set<string>();
  const visit = (span: OutlineSourceSpan, inherited: Readonly<Record<string, JsonValue>>) => {
    if (span.token) {
      const data = referenceData(span.token);
      if (data?.kind === "supertag") {
        const last = entries.at(-1);
        if (last?.kind === "text" && last.value === " ") {
          entries.pop();
        }
        supertagIds.add(data.targetNodeId);
        return;
      }
      if (data) {
        entries.push({ kind: "reference", data });
        return;
      }
    }
    const key = span.extension?.id;
    const attributes = key === "bold" || key === "italic" || key === "code" ? { ...inherited, [key]: true } : inherited;
    if (span.children) {
      span.children.forEach((child) => visit(child, attributes));
    } else {
      entries.push(
        ...Array.from(key === "code" ? span.text.replace(/\\([\\`])/gu, "$1") : span.text).map((value) => ({
          kind: "text" as const,
          value,
          attributes,
        })),
      );
    }
  };
  parseOutlineContent(content, outlineFormatting).forEach((span) => visit(span, {}));
  return { entries, supertagIds };
}
export const contentIdentity = (node: ProjectedNode): string => JSON.stringify(node.content);

export function incompleteReference(content: OutlineContent): boolean {
  const incomplete = (span: OutlineSourceSpan): boolean => {
    if (span.token || span.extension?.id === "code" || span.extension?.id === "escape") {
      return false;
    }
    if (span.children) {
      return span.children.some(incomplete);
    }
    let open = false;
    for (let index = 0; index < span.text.length; index += 1) {
      const char = span.text[index];
      if (char === "\\") {
        index += 1;
        continue;
      }
      if ((char === "@" || char === "#") && span.text[index + 1] === "{") {
        if (open) {
          return true;
        }
        open = true;
        index += 1;
      } else if (char === "}") {
        open = false;
      }
    }
    return open;
  };
  return parseOutlineContent(content, outlineFormatting).some(incomplete);
}

// Receipts can supply reference IDs without changing the source the user is editing.
export function sameSource(left: OutlineContent, right: OutlineContent): boolean {
  const signature = (content: OutlineContent) =>
    content.map((item) => {
      if (item.type === "text") {
        return ["text", item.text];
      }
      const data = referenceData(item);
      return [
        "token",
        item.extension,
        item.source,
        item.label,
        data?.kind,
        data?.targetNodeId,
        data?.aliasNodeId ?? null,
      ];
    });
  return JSON.stringify(signature(left)) === JSON.stringify(signature(right));
}
