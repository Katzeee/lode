import type { ProjectionIdentity, ProjectionPerspective } from "../../../../domain/fact/index.js";
import {
  isProjectionSectionEntry,
  isProjectionSectionValue,
  PROJECTION_SECTION_NAMES,
  type Projection,
  type ProjectionSectionName,
  type ProjectionSections,
} from "../../../../domain/reconcile/index.js";

export type MaterializedProjectionEntry = Readonly<{
  section: ProjectionSectionName;
  identity: string;
  value: unknown;
}>;

type SectionCodec = Readonly<{
  empty: () => unknown;
  entries: (projection: Projection) => readonly Readonly<{ identity: string; value: unknown }>[];
  assign: (projection: Projection, identity: string, value: unknown) => void;
  isValue: (identity: string, value: unknown) => boolean;
}>;

const SECTION_CODECS = {
  nodes: indexedSection("nodes"),
  occurrences: indexedSection("occurrences"),
  childOccurrences: indexedSection("childOccurrences"),
  nodeOwners: indexedSection("nodeOwners"),
  metanodes: indexedSection("metanodes"),
  workspaceSystemNodes: indexedSection("workspaceSystemNodes"),
  supertagApplications: indexedSection("supertagApplications"),
  supertagTemplateNodes: indexedSection("supertagTemplateNodes"),
  templateFields: indexedSection("templateFields"),
  optionalFieldContributions: indexedSection("optionalFieldContributions"),
  templateNodeInstances: sequence((value) => isProjectionSectionValue("templateNodeInstances", value)),
  supertagExtensions: indexedSection("supertagExtensions"),
  supertagInstanceSupertags: indexedSection("supertagInstanceSupertags"),
  supertagExtensionConflicts: indexedSection("supertagExtensionConflicts"),
  conflictIssues: indexedSection("conflictIssues"),
  materializedFields: indexedSection("materializedFields"),
  effectiveFields: indexedSection("effectiveFields"),
  optionalFieldSuggestions: indexedSection("optionalFieldSuggestions"),
  searchExpressions: indexedSection("searchExpressions"),
  sharedDefaultViewDefinitions: indexedSection("sharedDefaultViewDefinitions"),
  fieldDefinitionConfigurations: indexedSection("fieldDefinitionConfigurations"),
  typedFieldValues: indexedSection("typedFieldValues"),
} satisfies Readonly<Record<ProjectionSectionName, SectionCodec>>;

export function emptyMaterializedProjection(
  perspective: ProjectionPerspective,
  identity: ProjectionIdentity,
): Projection {
  const sections = Object.fromEntries(
    PROJECTION_SECTION_NAMES.map((section) => [section, SECTION_CODECS[section].empty()]),
  ) as ProjectionSections;
  return { perspective, identity, ...sections };
}

export function materializedProjectionEntries(projection: Projection): readonly MaterializedProjectionEntry[] {
  return PROJECTION_SECTION_NAMES.flatMap((section) =>
    SECTION_CODECS[section]
      .entries(projection)
      .map((entry) => ({ section, identity: entry.identity, value: entry.value })),
  );
}

export function assignMaterializedProjectionValue(
  projection: Projection,
  section: ProjectionSectionName,
  identity: string,
  value: unknown,
): void {
  SECTION_CODECS[section].assign(projection, identity, value);
}

export function isMaterializedProjectionValue(
  section: ProjectionSectionName,
  identity: string,
  value: unknown,
): boolean {
  return SECTION_CODECS[section].isValue(identity, value);
}

function indexed(
  section: Exclude<ProjectionSectionName, "templateNodeInstances">,
  isValue: (identity: string, value: unknown) => boolean,
): SectionCodec {
  return {
    empty: () => ({}),
    entries: (projection) =>
      Object.entries(projection[section] as Readonly<Record<string, unknown>>).map(([identity, value]) => ({
        identity,
        value,
      })),
    assign: (projection, identity, value) => {
      (projection[section] as Record<string, unknown>)[identity] = value;
    },
    isValue,
  };
}

function sequence(isValue: (value: unknown) => boolean): SectionCodec {
  return {
    empty: () => [],
    entries: (projection) =>
      projection.templateNodeInstances.map((value, index) => ({ identity: String(index), value })),
    assign: (projection, identity, value) => {
      (projection.templateNodeInstances as unknown[])[Number(identity)] = value;
    },
    isValue: (identity, value) => isSequenceIdentity(identity) && isValue(value),
  };
}

function indexedSection(section: Exclude<ProjectionSectionName, "templateNodeInstances">): SectionCodec {
  return indexed(section, (identity, value) => isProjectionSectionEntry(section, identity, value));
}

function isSequenceIdentity(identity: string): boolean {
  return /^(0|[1-9]\d*)$/.test(identity) && Number.isSafeInteger(Number(identity));
}
