// Purpose: Configures text marks and reads and writes formatted names and inline mentions.

import type { Delta, LoroDoc, LoroText } from "loro-crdt";
import type { NodeId } from "./node-id.ts";

/**
 * Text marks. A mark's expand behavior comes from the local configuration, not the document, so
 * every replica configures the same set before reading or writing text.
 */
export function configureText(doc: LoroDoc): void {
  doc.configTextStyle({
    bold: { expand: "after" },
    italic: { expand: "after" },
    strike: { expand: "after" },
    code: { expand: "none" },
    link: { expand: "none" },
    ref: { expand: "none" },
    date: { expand: "none" },
  });
}

export type Format = "bold" | "italic" | "strike" | "code";

/**
 * The character an inline mention or date marks. Loro has no embed type; a mark on one anchor
 * character stays on it while text is typed beside it, and deleting the anchor removes the mention.
 */
export const ANCHOR = "￼";

/** One run of a name: text with the marks over it. Indexes count UTF-16 code units. */
export type Run = {
  text: string;
  bold?: true;
  italic?: true;
  strike?: true;
  code?: true;
  link?: string;
  /** An inline mention: the run is the anchor and names its target. */
  ref?: NodeId;
  /** An inline date: the run is the anchor and carries the date. */
  date?: string;
};

export function runs(text: LoroText): Run[] {
  return text.toDelta().map(toRun);
}

export type InlineMention = { index: number; target: NodeId };

/** Every mention position, repeated mentions of one target included. */
export function inlineMentions(text: LoroText): InlineMention[] {
  const mentions: InlineMention[] = [];
  let index = 0;
  for (const delta of text.toDelta()) {
    const inserted = typeof delta.insert === "string" ? delta.insert : "";
    const target = delta.attributes?.ref;
    if (typeof target === "string") {
      for (let offset = 0; offset < inserted.length; offset++) {
        mentions.push({ index: index + offset, target: target as NodeId });
      }
    }
    index += inserted.length;
  }
  return mentions;
}

/** Writes into the open transaction; the caller commits. */
export function writeMention(text: LoroText, index: number, target: NodeId): void {
  text.insert(index, ANCHOR);
  text.mark({ start: index, end: index + 1 }, "ref", target);
}

/** The text from `start` to the end, marks included, as a delta another text can apply. */
export function tail(text: LoroText, start: number): Delta<string>[] {
  return start >= text.length ? [] : text.sliceDelta(start, text.length);
}

function toRun(delta: Delta<string>): Run {
  const run: Run = { text: typeof delta.insert === "string" ? delta.insert : "" };
  const marks = delta.attributes ?? {};
  for (const key of ["bold", "italic", "strike", "code"] as const) {
    if (marks[key] === true) {
      run[key] = true;
    }
  }
  if (typeof marks.link === "string") {
    run.link = marks.link;
  }
  if (typeof marks.ref === "string") {
    run.ref = marks.ref as NodeId;
  }
  if (typeof marks.date === "string") {
    run.date = marks.date;
  }
  return run;
}
