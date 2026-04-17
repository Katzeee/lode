import type { BlockEngine } from "../engine.js";
import type { BlockId, BlockView, Delta } from "../types.js";
import { deltaToText } from "../delta/utils.js";

// ── Inline serialization ──────────────────────────────────────────────────────

function escapeInline(text: string): string {
  return text.replace(/([\\`*_\[\]])/g, "\\$1");
}

function deltaToMarkdown(deltas: Delta): string {
  let out = "";
  for (const span of deltas) {
    let s = escapeInline(span.insert);
    const attrs = span.attributes ?? {};
    if (attrs.code) s = "`" + span.insert + "`";
    if (attrs.bold) s = "**" + s + "**";
    if (attrs.italic) s = "_" + s + "_";
    if (attrs.link) s = "[" + s + "](" + String(attrs.link) + ")";
    out += s;
  }
  return out;
}

// ── Serialize ──────────────────────────────────────────────────────────────────

export function toMarkdown(engine: BlockEngine, rootId?: BlockId): string {
  const lines: string[] = [];

  const serialize = (id: BlockId, depth: number): void => {
    const view = engine.getBlock(id);
    if (!view) return;
    const inline = deltaToMarkdown(view.deltas);
    const type = typeof view.props.type === "string" ? view.props.type : "paragraph";
    const spec = engine.getSpec(type);
    const indent = "  ".repeat(Math.max(0, depth));

    let rendered: string;
    if (spec?.markdown?.serialize) {
      rendered = spec.markdown.serialize(view, inline);
    } else {
      rendered = inline;
    }

    // Multi-line blocks (e.g. code) - preserve leading indent
    const blockLines = rendered.split("\n");
    for (const line of blockLines) lines.push(indent + line);

    for (const cid of view.childIds) serialize(cid, depth + 1);
  };

  const rootIds = rootId != null ? [rootId] : engine.getRootIds();
  for (const id of rootIds) serialize(id, 0);

  return lines.join("\n");
}

// ── Inline parsing ────────────────────────────────────────────────────────────

interface InlineToken {
  text: string;
  attrs: Record<string, unknown>;
}

function parseInlineMarks(text: string): Delta {
  // Simple tokenizer: handles backtick code, bold (** / __), italic (_ / *),
  // and links [text](href). Escaped characters with \ are preserved literally.
  const result: InlineToken[] = [];
  let i = 0;
  let buffer = "";
  const flushBuffer = (attrs: Record<string, unknown>): void => {
    if (buffer.length > 0) {
      result.push({ text: buffer, attrs: { ...attrs } });
      buffer = "";
    }
  };

  while (i < text.length) {
    const ch = text[i];

    // Escape
    if (ch === "\\" && i + 1 < text.length) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    // Inline code: `...`
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        flushBuffer({});
        result.push({ text: text.slice(i + 1, end), attrs: { code: true } });
        i = end + 1;
        continue;
      }
    }

    // Bold: ** ... **
    if (ch === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 1) {
        flushBuffer({});
        const inner = parseInlineMarks(text.slice(i + 2, end));
        for (const span of inner) {
          result.push({
            text: span.insert,
            attrs: { ...(span.attributes ?? {}), bold: true },
          });
        }
        i = end + 2;
        continue;
      }
    }

    // Bold: __ ... __
    if (ch === "_" && text[i + 1] === "_") {
      const end = text.indexOf("__", i + 2);
      if (end > i + 1) {
        flushBuffer({});
        const inner = parseInlineMarks(text.slice(i + 2, end));
        for (const span of inner) {
          result.push({
            text: span.insert,
            attrs: { ...(span.attributes ?? {}), bold: true },
          });
        }
        i = end + 2;
        continue;
      }
    }

    // Italic: * ... *
    if (ch === "*") {
      const end = text.indexOf("*", i + 1);
      if (end > i) {
        flushBuffer({});
        const inner = parseInlineMarks(text.slice(i + 1, end));
        for (const span of inner) {
          result.push({
            text: span.insert,
            attrs: { ...(span.attributes ?? {}), italic: true },
          });
        }
        i = end + 1;
        continue;
      }
    }

    // Italic: _ ... _
    if (ch === "_") {
      const end = text.indexOf("_", i + 1);
      if (end > i) {
        flushBuffer({});
        const inner = parseInlineMarks(text.slice(i + 1, end));
        for (const span of inner) {
          result.push({
            text: span.insert,
            attrs: { ...(span.attributes ?? {}), italic: true },
          });
        }
        i = end + 1;
        continue;
      }
    }

    // Link: [text](href)
    if (ch === "[") {
      const closeBracket = text.indexOf("]", i + 1);
      if (closeBracket > i && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen > closeBracket) {
          flushBuffer({});
          const linkText = text.slice(i + 1, closeBracket);
          const href = text.slice(closeBracket + 2, closeParen);
          const inner = parseInlineMarks(linkText);
          for (const span of inner) {
            result.push({
              text: span.insert,
              attrs: { ...(span.attributes ?? {}), link: href },
            });
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    buffer += ch;
    i++;
  }
  flushBuffer({});

  // Convert tokens to Delta (merge adjacent same-attrs)
  const out: Delta = [];
  for (const tok of result) {
    if (tok.text.length === 0) continue;
    const last = out[out.length - 1];
    const hasAttrs = Object.keys(tok.attrs).length > 0;
    if (last && sameAttrs(last.attributes, hasAttrs ? tok.attrs : undefined)) {
      last.insert += tok.text;
    } else {
      out.push(hasAttrs ? { insert: tok.text, attributes: tok.attrs } : { insert: tok.text });
    }
  }
  return out;
}

function sameAttrs(a?: Record<string, unknown>, b?: Record<string, unknown>): boolean {
  const aKeys = a ? Object.keys(a) : [];
  const bKeys = b ? Object.keys(b) : [];
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!b || a![k] !== b[k]) return false;
  }
  return true;
}

// ── Parse ─────────────────────────────────────────────────────────────────────

interface ParsedLine {
  indent: number;           // spaces of indent (2 spaces = 1 level)
  type: string;
  props: Record<string, unknown>;
  text: string;
  raw: string;
}

function parseLine(line: string): ParsedLine | null {
  // Strip indent
  const indentMatch = /^(\s*)(.*)$/.exec(line);
  if (!indentMatch) return null;
  const indent = Math.floor(indentMatch[1].length / 2);
  const content = indentMatch[2];
  if (content.length === 0) return null;

  // Heading
  let m = /^(#{1,6})\s+(.*)$/.exec(content);
  if (m) return { indent, type: "heading", props: { level: m[1].length }, text: m[2], raw: content };

  // Todo
  m = /^-\s+\[([ xX])\]\s+(.*)$/.exec(content);
  if (m) {
    return {
      indent,
      type: "todo",
      props: { checked: m[1].toLowerCase() === "x" },
      text: m[2],
      raw: content,
    };
  }

  // Bullet
  m = /^[-*+]\s+(.*)$/.exec(content);
  if (m) return { indent, type: "bullet", props: {}, text: m[1], raw: content };

  // Numbered
  m = /^(\d+)\.\s+(.*)$/.exec(content);
  if (m) return { indent, type: "numbered", props: { order: Number(m[1]) }, text: m[2], raw: content };

  // Quote
  m = /^>\s?(.*)$/.exec(content);
  if (m) return { indent, type: "quote", props: {}, text: m[1], raw: content };

  // Divider
  if (/^---+$/.test(content.trim())) {
    return { indent, type: "divider", props: {}, text: "", raw: content };
  }

  // Paragraph
  return { indent, type: "paragraph", props: {}, text: content, raw: content };
}

export function fromMarkdown(
  engine: BlockEngine,
  text: string,
  parentId?: BlockId,
): BlockId[] {
  const rawLines = text.split("\n");
  const createdTops: BlockId[] = [];

  engine.batch(() => {
    // Stack: (blockId, indentLevel)
    const stack: Array<{ id: BlockId; indent: number }> = [];
    let i = 0;

    while (i < rawLines.length) {
      const line = rawLines[i];

      // Code fence
      const fenceMatch = /^(\s*)```(.*)$/.exec(line);
      if (fenceMatch) {
        const indent = Math.floor(fenceMatch[1].length / 2);
        const lang = fenceMatch[2].trim();
        const codeLines: string[] = [];
        i++;
        while (i < rawLines.length) {
          const closeMatch = /^\s*```\s*$/.exec(rawLines[i]);
          if (closeMatch) { i++; break; }
          codeLines.push(rawLines[i]);
          i++;
        }
        const codeText = codeLines.join("\n");
        const parent = findParent(stack, indent);
        const id = engine.createBlock(parent ?? parentId);
        engine.setBlockType(id, "code");
        if (lang.length > 0) engine.setProp(id, "language", lang);
        if (codeText.length > 0) engine.replaceDeltas(id, [{ insert: codeText }]);
        pruneStack(stack, indent);
        stack.push({ id, indent });
        if (parent == null) createdTops.push(id);
        continue;
      }

      const parsed = parseLine(line);
      if (parsed == null) { i++; continue; }

      const parent = findParent(stack, parsed.indent);
      const id = engine.createBlock(parent ?? parentId);
      if (parsed.type !== "paragraph") engine.setBlockType(id, parsed.type);
      for (const [k, v] of Object.entries(parsed.props)) engine.setProp(id, k, v);
      if (parsed.text.length > 0) {
        const deltas = parseInlineMarks(parsed.text);
        if (deltas.length > 0) engine.replaceDeltas(id, deltas);
      }
      pruneStack(stack, parsed.indent);
      stack.push({ id, indent: parsed.indent });
      if (parent == null) createdTops.push(id);
      i++;
    }
  });

  return createdTops;
}

function findParent(
  stack: Array<{ id: BlockId; indent: number }>,
  indent: number,
): BlockId | null {
  for (let k = stack.length - 1; k >= 0; k--) {
    if (stack[k].indent < indent) return stack[k].id;
  }
  return null;
}

function pruneStack(
  stack: Array<{ id: BlockId; indent: number }>,
  indent: number,
): void {
  while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
}

// Stub for unused — helps TS --noEmit
void deltaToText;
void ({} as BlockView);
