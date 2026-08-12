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
  | "schemaApplications"
  | "schemaFields"
  | "schemaFieldItems"
  | "schemaExtensions"
  | "schemaSearchMembers"
  | "schemaExtensionConflicts"
  | "conflictIssues"
  | "effectiveFields"
  | "materializedFields"
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
    schemaApplications:
      section === "schemaApplications" ? (indexed as ProjectionPage["schemaApplications"]) : {},
    schemaFields: section === "schemaFields" ? (indexed as ProjectionPage["schemaFields"]) : {},
    schemaFieldItems:
      section === "schemaFieldItems" ? (indexed as ProjectionPage["schemaFieldItems"]) : {},
    schemaExtensions:
      section === "schemaExtensions" ? (indexed as ProjectionPage["schemaExtensions"]) : {},
    schemaSearchMembers:
      section === "schemaSearchMembers" ? (indexed as ProjectionPage["schemaSearchMembers"]) : {},
    schemaExtensionConflicts:
      section === "schemaExtensionConflicts"
        ? (indexed as ProjectionPage["schemaExtensionConflicts"])
        : {},
    conflictIssues:
      section === "conflictIssues" ? (indexed as ProjectionPage["conflictIssues"]) : {},
    effectiveFields:
      section === "effectiveFields" ? (indexed as ProjectionPage["effectiveFields"]) : {},
    materializedFields:
      section === "materializedFields" ? (indexed as ProjectionPage["materializedFields"]) : {},
  };
}
