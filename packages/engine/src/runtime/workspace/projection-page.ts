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
  | "nodeOwners"
  | "addressedValues"
  | "schemaApplications"
  | "schemaFields"
  | "templateFields"
  | "schemaTemplateNodes"
  | "templateNodeInstances"
  | "schemaExtensions"
  | "schemaSearchMembers"
  | "schemaExtensionConflicts"
  | "nodeStatuses"
  | "conflictIssues"
  | "effectiveFields"
  | "materializedFields"
> {
  const indexed = Object.fromEntries(entries.map((entry) => [entry.identity, entry.value]));
  return {
    nodes: section === "nodes" ? (indexed as ProjectionPage["nodes"]) : {},
    occurrences: section === "occurrences" ? (indexed as ProjectionPage["occurrences"]) : {},
    children: section === "children" ? (indexed as ProjectionPage["children"]) : {},
    nodeOwners: section === "nodeOwners" ? (indexed as ProjectionPage["nodeOwners"]) : {},
    addressedValues:
      section === "addressedValues" ? (indexed as ProjectionPage["addressedValues"]) : {},
    schemaApplications:
      section === "schemaApplications" ? (indexed as ProjectionPage["schemaApplications"]) : {},
    schemaFields: section === "schemaFields" ? (indexed as ProjectionPage["schemaFields"]) : {},
    templateFields:
      section === "templateFields" ? (indexed as ProjectionPage["templateFields"]) : {},
    schemaTemplateNodes:
      section === "schemaTemplateNodes" ? (indexed as ProjectionPage["schemaTemplateNodes"]) : {},
    templateNodeInstances:
      section === "templateNodeInstances"
        ? (entries.map((entry) => entry.value) as ProjectionPage["templateNodeInstances"])
        : [],
    schemaExtensions:
      section === "schemaExtensions" ? (indexed as ProjectionPage["schemaExtensions"]) : {},
    schemaSearchMembers:
      section === "schemaSearchMembers" ? (indexed as ProjectionPage["schemaSearchMembers"]) : {},
    schemaExtensionConflicts:
      section === "schemaExtensionConflicts"
        ? (indexed as ProjectionPage["schemaExtensionConflicts"])
        : {},
    nodeStatuses: section === "nodeStatuses" ? (indexed as ProjectionPage["nodeStatuses"]) : {},
    conflictIssues:
      section === "conflictIssues" ? (indexed as ProjectionPage["conflictIssues"]) : {},
    effectiveFields:
      section === "effectiveFields" ? (indexed as ProjectionPage["effectiveFields"]) : {},
    materializedFields:
      section === "materializedFields" ? (indexed as ProjectionPage["materializedFields"]) : {},
  };
}
