import type { ValueTarget } from "../fact/index.js";

type ValueNamespace = "property" | "metadata" | "schema";

export function valueTargetAddress(target: ValueTarget, namespace: ValueNamespace): string {
  return [target.kind, target.id, namespace].map(encodeURIComponent).join("/");
}

export function valueKeyAddress(target: ValueTarget, namespace: ValueNamespace, key: string): string {
  return `${valueTargetAddress(target, namespace)}/${encodeURIComponent(key)}`;
}

export function impactAddress(...segments: readonly (string | null)[]): string {
  return segments.map((segment) => (segment === null ? "n" : `s${encodeURIComponent(segment)}`)).join("/");
}
