import type { ValueOwner } from "../fact/index.js";

type ValueNamespace = "property" | "metadata" | "schema";

export function valueOwnerAddress(owner: ValueOwner, namespace: ValueNamespace): string {
  return [owner.kind, owner.id, namespace].map(encodeURIComponent).join("/");
}

export function valueKeyAddress(owner: ValueOwner, namespace: ValueNamespace, key: string): string {
  return `${valueOwnerAddress(owner, namespace)}/${encodeURIComponent(key)}`;
}

export function impactAddress(...segments: readonly (string | null)[]): string {
  return segments
    .map((segment) => (segment === null ? "n" : `s${encodeURIComponent(segment)}`))
    .join("/");
}
