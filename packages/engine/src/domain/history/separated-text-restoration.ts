import { canonicalJson, type GraphAction, type JsonValue } from "../fact/index.js";
import type { ProjectedNode } from "../reconcile/index.js";
import type { CompensationStep } from "./compensation-types.js";

type Text = Extract<ProjectedNode["content"][number], { kind: "text" }>;
type Run = { atoms: Text[]; start: number; end: number };
export function restoreSeparatedText(
  nodeId: string,
  deleted: readonly Text[],
  previous: ProjectedNode["content"],
  current: ProjectedNode["content"],
  inserted: readonly Text[],
): CompensationStep | null {
  const deletedIds = new Set(deleted.map((atom) => atom.id));
  const runs: Run[] = [];
  previous.forEach((item, index) => {
    if (item.kind !== "text" || !deletedIds.has(item.id)) {
      return;
    }
    const last = runs.at(-1);
    if (last?.end === index) {
      last.atoms.push(item);
      last.end = index + 1;
    } else {
      runs.push({ atoms: [item], start: index, end: index + 1 });
    }
  });
  if (runs.length <= 1) {
    return null;
  }
  const insertedIds = new Set<string>(inserted.map((atom) => atom.id));
  const liveIds = new Set(current.filter((item) => !insertedIds.has(item.id)).map((item) => item.id));
  const restorations = new Map<
    string,
    { anchor: Extract<GraphAction, { kind: "rich-text-splice" }>["anchor"]; atoms: Text[] }
  >();
  for (const run of runs) {
    const before = previous.slice(run.end).find((item) => liveIds.has(item.id))?.id ?? null;
    const after =
      previous
        .slice(0, run.start)
        .reverse()
        .find((item) => liveIds.has(item.id))?.id ?? null;
    const anchor = {
      before,
      after,
      affinity: "before" as const,
      fallback: run.start === 0 ? ("start" as const) : ("end" as const),
    };
    const key = canonicalJson(anchor);
    const existing = restorations.get(key);
    if (existing) {
      existing.atoms.push(...run.atoms);
    } else {
      restorations.set(key, { anchor, atoms: [...run.atoms] });
    }
  }
  const actions: GraphAction[] = [];
  for (const { anchor, atoms } of restorations.values()) {
    const groups = textGroups(atoms);
    if (anchor.before === null && (anchor.after !== null || anchor.fallback === "start")) {
      groups.reverse();
    }
    for (const group of groups) {
      actions.push({
        kind: "rich-text-splice",
        nodeId,
        deleteAtomIds: actions.length === 0 ? inserted.map((atom) => atom.id) : [],
        anchor,
        insert: group.text,
        attributes: group.attributes,
      });
    }
  }
  return { kind: "ready", actions };
}
export function textGroups(
  atoms: readonly Readonly<{ value: string; attributes: Readonly<Record<string, JsonValue>> }>[],
): { text: string; attributes: Readonly<Record<string, JsonValue>> }[] {
  const groups: { text: string; attributes: Readonly<Record<string, JsonValue>> }[] = [];
  for (const atom of atoms) {
    const last = groups.at(-1);
    if (last && canonicalJson(last.attributes) === canonicalJson(atom.attributes)) {
      last.text += atom.value;
    } else {
      groups.push({ text: atom.value, attributes: atom.attributes });
    }
  }
  return groups;
}
