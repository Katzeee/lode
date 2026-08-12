import type { ProjectionPage, ProjectionPageSection } from "../../application/contract.js";

export function stableIdentityAfter(identity: string, cursor: string): boolean {
  return identity.localeCompare(cursor) > 0;
}

export function projectionPageMaps(
  section: ProjectionPageSection,
  entries: readonly Readonly<{ identity: string; value: unknown }>[],
): Pick<
  ProjectionPage,
  | "nodes"
  | "occurrences"
  | "children"
  | "canonicalOccurrences"
  | "addressedValues"
  | "managedChildren"
> {
  const indexed = Object.fromEntries(entries.map((entry) => [entry.identity, entry.value]));
  return {
    nodes: section === "nodes" ? (indexed as ProjectionPage["nodes"]) : {},
    occurrences: section === "occurrences" ? (indexed as ProjectionPage["occurrences"]) : {},
    children: section === "children" ? (indexed as ProjectionPage["children"]) : {},
    canonicalOccurrences:
      section === "canonicalOccurrences" ? (indexed as ProjectionPage["canonicalOccurrences"]) : {},
    addressedValues:
      section === "addressedValues" ? (indexed as ProjectionPage["addressedValues"]) : {},
    managedChildren:
      section === "managedChildren"
        ? (entries.map((entry) => entry.value) as ProjectionPage["managedChildren"])
        : [],
  };
}
