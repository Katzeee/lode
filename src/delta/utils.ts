import type { Delta, DeltaInsert } from "../types.js";

function cloneAttrs(attrs?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!attrs) return undefined;
  const keys = Object.keys(attrs);
  if (keys.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = attrs[k];
  return out;
}

function attrsEqual(a?: Record<string, unknown>, b?: Record<string, unknown>): boolean {
  const aKeys = a ? Object.keys(a) : [];
  const bKeys = b ? Object.keys(b) : [];
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!b || !(k in b)) return false;
    if (a![k] !== b[k]) {
      // Handle object equality via JSON fallback (mark values may be objects)
      if (JSON.stringify(a![k]) !== JSON.stringify(b[k])) return false;
    }
  }
  return true;
}

function pushSpan(out: Delta, insert: string, attrs?: Record<string, unknown>): void {
  if (insert.length === 0) return;
  const cleaned = cloneAttrs(attrs);
  const last = out[out.length - 1];
  if (last && attrsEqual(last.attributes, cleaned)) {
    last.insert += insert;
    return;
  }
  const span: DeltaInsert = { insert };
  if (cleaned) span.attributes = cleaned;
  out.push(span);
}

export function getDeltaLength(deltas: Delta): number {
  let n = 0;
  for (const s of deltas) n += s.insert.length;
  return n;
}

export function splitDeltaAt(deltas: Delta, offset: number): [Delta, Delta] {
  const before: Delta = [];
  const after: Delta = [];
  let pos = 0;
  for (const span of deltas) {
    const end = pos + span.insert.length;
    if (end <= offset) {
      pushSpan(before, span.insert, span.attributes);
    } else if (pos >= offset) {
      pushSpan(after, span.insert, span.attributes);
    } else {
      const cut = offset - pos;
      pushSpan(before, span.insert.slice(0, cut), span.attributes);
      pushSpan(after, span.insert.slice(cut), span.attributes);
    }
    pos = end;
  }
  return [before, after];
}

export function sliceDelta(deltas: Delta, start: number, end: number): Delta {
  if (end <= start) return [];
  const out: Delta = [];
  let pos = 0;
  for (const span of deltas) {
    const spanEnd = pos + span.insert.length;
    if (spanEnd <= start) {
      pos = spanEnd;
      continue;
    }
    if (pos >= end) break;
    const from = Math.max(0, start - pos);
    const to = Math.min(span.insert.length, end - pos);
    pushSpan(out, span.insert.slice(from, to), span.attributes);
    pos = spanEnd;
  }
  return out;
}

export function mergeDelta(a: Delta, b: Delta): Delta {
  const out: Delta = [];
  for (const s of a) pushSpan(out, s.insert, s.attributes);
  for (const s of b) pushSpan(out, s.insert, s.attributes);
  return out;
}

export function applyAttributes(
  deltas: Delta,
  start: number,
  end: number,
  attrs: Record<string, unknown | null>,
): Delta {
  if (end <= start) return deltas.map(s => ({ insert: s.insert, ...(s.attributes ? { attributes: cloneAttrs(s.attributes) } : {}) }));
  const out: Delta = [];
  let pos = 0;
  for (const span of deltas) {
    const spanEnd = pos + span.insert.length;
    // Determine overlap segments within this span
    const overlapStart = Math.max(pos, start);
    const overlapEnd = Math.min(spanEnd, end);
    if (overlapEnd <= overlapStart) {
      pushSpan(out, span.insert, span.attributes);
    } else {
      // Leading segment (unchanged)
      if (overlapStart > pos) {
        pushSpan(out, span.insert.slice(0, overlapStart - pos), span.attributes);
      }
      // Overlap segment (attrs merged)
      const base = cloneAttrs(span.attributes) ?? {};
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null) delete base[k];
        else base[k] = v;
      }
      const merged = Object.keys(base).length > 0 ? base : undefined;
      pushSpan(out, span.insert.slice(overlapStart - pos, overlapEnd - pos), merged);
      // Trailing segment (unchanged)
      if (overlapEnd < spanEnd) {
        pushSpan(out, span.insert.slice(overlapEnd - pos), span.attributes);
      }
    }
    pos = spanEnd;
  }
  return out;
}

export function isAttributeActiveInRange(
  deltas: Delta,
  start: number,
  end: number,
  key: string,
): boolean {
  if (end <= start) return false;
  let pos = 0;
  let covered = 0;
  for (const span of deltas) {
    const spanEnd = pos + span.insert.length;
    if (spanEnd <= start) {
      pos = spanEnd;
      continue;
    }
    if (pos >= end) break;
    const value = span.attributes?.[key];
    if (value == null || value === false) return false;
    const from = Math.max(pos, start);
    const to = Math.min(spanEnd, end);
    covered += to - from;
    pos = spanEnd;
  }
  return covered === end - start;
}

export function toggleAttribute(
  deltas: Delta,
  start: number,
  end: number,
  key: string,
  value: unknown,
): Delta {
  if (end <= start) return deltas.map(s => ({ insert: s.insert, ...(s.attributes ? { attributes: cloneAttrs(s.attributes) } : {}) }));
  const active = isAttributeActiveInRange(deltas, start, end, key);
  return applyAttributes(deltas, start, end, { [key]: active ? null : value });
}

export function getAttributeAtOffset(
  deltas: Delta,
  offset: number,
  key: string,
): unknown {
  let pos = 0;
  for (const span of deltas) {
    const spanEnd = pos + span.insert.length;
    if (offset >= pos && offset < spanEnd) {
      const v = span.attributes?.[key];
      return v == null ? null : v;
    }
    pos = spanEnd;
  }
  return null;
}

export function deltaToText(deltas: Delta): string {
  let s = "";
  for (const span of deltas) s += span.insert;
  return s;
}

export function textToDelta(text: string): Delta {
  return text.length === 0 ? [] : [{ insert: text }];
}

export function deltasEqual(a: Delta, b: Delta): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].insert !== b[i].insert) return false;
    if (!attrsEqual(a[i].attributes, b[i].attributes)) return false;
  }
  return true;
}
