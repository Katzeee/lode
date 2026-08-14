import type { ProjectionIdentity, ViewMode } from "../domain/fact/index.js";
import type { ProjectionSections, ProjectionSectionName } from "../domain/reconcile/index.js";

export type ProjectionPageSection = ProjectionSectionName;

export const PROJECTION_PAGE_SECTIONS = [
  "nodes",
  "occurrences",
  "children",
  "nodeOwners",
  "addressedValues",
  "schemaApplications",
  "schemaFields",
  "templateFields",
  "schemaTemplateNodes",
  "templateNodeInstances",
  "schemaExtensions",
  "schemaSearchMembers",
  "schemaExtensionConflicts",
  "nodeStatuses",
  "conflictIssues",
  "effectiveFields",
  "materializedFields",
] as const satisfies readonly ProjectionPageSection[];

type AssertNever<Value extends never> = Value;
export type ProjectionPageSectionsAreComplete = AssertNever<
  Exclude<ProjectionPageSection, (typeof PROJECTION_PAGE_SECTIONS)[number]>
>;

export type ProjectionPageValue<Section extends ProjectionPageSection = ProjectionPageSection> =
  Section extends ProjectionPageSection
    ? ProjectionSections[Section] extends readonly (infer Item)[]
      ? Item
      : ProjectionSections[Section] extends Readonly<Record<string, infer Item>>
        ? Item
        : never
    : never;

export type ProjectionPage<Section extends ProjectionPageSection = ProjectionPageSection> =
  Section extends ProjectionPageSection
    ? Readonly<{
        identity: ProjectionIdentity;
        view: ViewMode;
        section: Section;
        next: string | null;
      }> &
        Readonly<Pick<ProjectionSections, Section>>
    : never;
