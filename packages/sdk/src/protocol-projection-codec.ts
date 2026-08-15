import type {
  EffectiveField,
  FieldConfigCandidate,
  FieldInitializationCandidate,
  ProjectionPage,
  ProjectionPageSection,
  TemplateField,
} from "./projection.js";
import type { ConflictIssue } from "./review.js";
import {
  fromConflictIssue,
  fromFieldTemplateConfig,
  fromFieldValueSeed,
  fromProtocolValue,
  required,
  toConflictIssue,
  toFieldTemplateConfig,
  toFieldValueSeed,
} from "./protocol-shape-codec.js";
import type { FieldValueSeed } from "./model.js";

export function toProjectionPage(page: ProjectionPage): Record<string, unknown> {
  const section = page.section;
  return {
    identity: page.identity,
    view: page.view,
    next: page.next,
    content: {
      $case: section,
      value: projectionSectionToProtocol(section, (page as unknown as Record<string, unknown>)[section]),
    },
  };
}

export function fromProjectionPage(value: unknown): ProjectionPage {
  const page = value as Record<string, unknown>;
  const content = required(page.content as { $case: ProjectionPageSection; value: unknown } | null, "Projection page");
  return {
    identity: required(fromProtocolValue(page.identity), "Projection identity"),
    view: page.view,
    section: content.$case,
    next: page.next,
    [content.$case]: projectionSectionFromProtocol(content.$case, content.value),
  } as ProjectionPage;
}

function projectionSectionToProtocol(section: ProjectionPageSection, value: unknown): Record<string, unknown> {
  if (section === "templateNodeInstances") {
    return { values: value };
  }
  const entries = value as Readonly<Record<string, unknown>>;
  if (isStringListSection(section)) {
    return { values: mapValues(entries, (item) => ({ values: item })) };
  }
  if (section === "addressedValues") {
    return { values: mapValues(entries, (item) => ({ values: item })) };
  }
  if (section === "templateFields") {
    return {
      values: mapValues(entries, (item) => ({ values: (item as readonly TemplateField[]).map(toTemplateField) })),
    };
  }
  if (section === "effectiveFields") {
    return {
      values: mapValues(entries, (item) => ({ values: (item as readonly EffectiveField[]).map(toEffectiveField) })),
    };
  }
  if (section === "materializedFields") {
    return { values: mapValues(entries, (item) => ({ values: item })) };
  }
  if (section === "conflictIssues") {
    return { values: mapValues(entries, (item) => toConflictIssue(item as ConflictIssue)) };
  }
  return { values: entries };
}

function projectionSectionFromProtocol(section: ProjectionPageSection, value: unknown): unknown {
  const wrapper = value as { values: unknown };
  if (section === "templateNodeInstances") {
    return wrapper.values;
  }
  const entries = wrapper.values as Readonly<Record<string, unknown>>;
  if (isStringListSection(section) || section === "addressedValues" || section === "materializedFields") {
    return mapValues(entries, (item) => (item as { values: unknown }).values);
  }
  if (section === "templateFields") {
    return mapValues(entries, (item) => (item as { values: readonly unknown[] }).values.map(fromTemplateField));
  }
  if (section === "effectiveFields") {
    return mapValues(entries, (item) => (item as { values: readonly unknown[] }).values.map(fromEffectiveField));
  }
  if (section === "conflictIssues") {
    return mapValues(entries, fromConflictIssue);
  }
  return entries;
}

function isStringListSection(section: ProjectionPageSection): boolean {
  return (
    section === "children" ||
    section === "schemaApplications" ||
    section === "schemaFields" ||
    section === "schemaTemplateNodes" ||
    section === "schemaExtensions" ||
    section === "schemaSearchMembers" ||
    section === "schemaExtensionConflicts"
  );
}

function toTemplateField(field: TemplateField): Record<string, unknown> {
  return {
    ...field,
    configCandidates: field.configCandidates.map(toFieldConfigCandidate),
    effectiveConfig: field.effectiveConfig === null ? null : toFieldTemplateConfig(field.effectiveConfig),
  };
}

function fromTemplateField(value: unknown): TemplateField {
  const field = value as Record<string, unknown>;
  return {
    ...field,
    configCandidates: (field.configCandidates as readonly unknown[]).map(fromFieldConfigCandidate),
    effectiveConfig: field.effectiveConfig === null ? null : fromFieldTemplateConfig(field.effectiveConfig),
  } as unknown as TemplateField;
}

function toEffectiveField(field: EffectiveField): Record<string, unknown> {
  return {
    ...field,
    configCandidates: field.configCandidates.map(toFieldConfigCandidate),
    effectiveConfig: field.effectiveConfig === null ? null : toFieldTemplateConfig(field.effectiveConfig),
    initializationCandidates: field.initializationCandidates.map(toFieldInitializationCandidate),
    initializedValues:
      field.initializedValues === null ? null : { values: field.initializedValues.map(toFieldValueSeed) },
  };
}

function fromEffectiveField(value: unknown): EffectiveField {
  const field = value as Record<string, unknown>;
  return {
    ...field,
    configCandidates: (field.configCandidates as readonly unknown[]).map(fromFieldConfigCandidate),
    effectiveConfig: field.effectiveConfig === null ? null : fromFieldTemplateConfig(field.effectiveConfig),
    initializationCandidates: (field.initializationCandidates as readonly unknown[]).map(
      fromFieldInitializationCandidate,
    ),
    initializedValues:
      field.initializedValues === null
        ? null
        : ((field.initializedValues as { values: readonly unknown[] }).values.map(
            fromFieldValueSeed,
          ) as readonly FieldValueSeed[]),
  } as unknown as EffectiveField;
}

function toFieldConfigCandidate(candidate: FieldConfigCandidate): Record<string, unknown> {
  return { ...candidate, config: toFieldTemplateConfig(candidate.config) };
}

function fromFieldConfigCandidate(value: unknown): FieldConfigCandidate {
  const candidate = value as Record<string, unknown>;
  return { ...candidate, config: fromFieldTemplateConfig(candidate.config) } as FieldConfigCandidate;
}

function toFieldInitializationCandidate(candidate: FieldInitializationCandidate): Record<string, unknown> {
  return { ...candidate, values: candidate.values.map(toFieldValueSeed) };
}

function fromFieldInitializationCandidate(value: unknown): FieldInitializationCandidate {
  const candidate = value as Record<string, unknown>;
  return {
    ...candidate,
    values: (candidate.values as readonly unknown[]).map(fromFieldValueSeed),
  } as unknown as FieldInitializationCandidate;
}

function mapValues(
  value: Readonly<Record<string, unknown>>,
  transform: (item: unknown) => unknown,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item)]));
}
