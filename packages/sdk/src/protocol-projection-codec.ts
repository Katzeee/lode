import type {
  EffectiveField,
  FieldConfigCandidate,
  FieldInitializationCandidate,
  ProjectionPage,
  ProjectionPageSection,
  TemplateField,
  ProjectedNode,
  NodeContentItem,
  SearchClause,
  SharedDefaultViewDefinition,
  FieldDefinitionConfiguration,
} from "./projection.js";
import type { ConflictIssue } from "./review.js";
import {
  fromConflictIssue,
  fromSupertagFieldConfig,
  fromFieldValueSeed,
  fromProtocolValue,
  required,
  toConflictIssue,
  toSupertagFieldConfig,
  toFieldValueSeed,
} from "./protocol-shape-codec.js";
import type { FieldValueSeed } from "./model.js";
import {
  fromFieldDefinitionConfiguration,
  toFieldDefinitionConfiguration,
} from "./protocol-field-definition-configuration-codec.js";

export function toProjectionPage(page: ProjectionPage): Record<string, unknown> {
  const section = page.section;
  return {
    identity: page.identity,
    perspective: page.perspective,
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
    perspective: page.perspective,
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
  if (section === "fieldDefinitionConfigurations") {
    return {
      values: mapValues(entries, (item) => ({
        values: (item as readonly FieldDefinitionConfiguration[]).map(toFieldDefinitionConfiguration),
      })),
    };
  }
  if (section === "searchClauses") {
    return {
      values: mapValues(entries, (item) => ({
        values: (item as readonly SearchClause[]).map(toSearchClause),
      })),
    };
  }
  if (section === "sharedDefaultViewDefinitions") {
    return {
      values: mapValues(entries, (item) => ({
        values: (item as readonly SharedDefaultViewDefinition[]).map((definition) => ({
          ...definition,
        })),
      })),
    };
  }
  if (section === "conflictIssues") {
    return { values: mapValues(entries, (item) => toConflictIssue(item as ConflictIssue)) };
  }
  if (section === "nodes") {
    return { values: mapValues(entries, (item) => toProjectedNode(item as ProjectedNode)) };
  }
  return { values: entries };
}

function projectionSectionFromProtocol(section: ProjectionPageSection, value: unknown): unknown {
  const wrapper = value as { values: unknown };
  if (section === "templateNodeInstances") {
    return wrapper.values;
  }
  const entries = wrapper.values as Readonly<Record<string, unknown>>;
  if (isStringListSection(section) || section === "materializedFields") {
    return mapValues(entries, (item) => (item as { values: unknown }).values);
  }
  if (section === "fieldDefinitionConfigurations") {
    return mapValues(entries, (item) =>
      (item as { values: readonly unknown[] }).values.map(fromFieldDefinitionConfiguration),
    );
  }
  if (section === "searchClauses") {
    return mapValues(entries, (item) => (item as { values: readonly unknown[] }).values.map(fromSearchClause));
  }
  if (section === "sharedDefaultViewDefinitions") {
    return mapValues(entries, (item) =>
      (item as { values: readonly Record<string, unknown>[] }).values.map((definition) => ({
        ...definition,
      })),
    );
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
  if (section === "nodes") {
    return mapValues(entries, fromProjectedNode);
  }
  return entries;
}

function toSearchClause(clause: SearchClause): Record<string, unknown> {
  const { kind: _kind, ...value } = clause;
  return {
    clause: {
      $case: clause.kind === "supertag-instance-of" ? "supertagInstanceOf" : "fieldDefined",
      value,
    },
  };
}

function fromSearchClause(value: unknown): SearchClause {
  const selected = required(
    (
      value as {
        clause?: { $case: "supertagInstanceOf" | "fieldDefined"; value: Record<string, unknown> } | null;
      }
    ).clause,
    "Search clause",
  );
  return {
    ...selected.value,
    kind: selected.$case === "supertagInstanceOf" ? "supertag-instance-of" : "field-defined",
  } as SearchClause;
}

function toProjectedNode(node: ProjectedNode): Record<string, unknown> {
  return {
    ...node,
    content: node.content.map((item) => ({
      content: {
        $case: item.kind === "text" ? "text" : "inlineReference",
        value: withoutKind(item),
      },
    })),
  };
}

function fromProjectedNode(value: unknown): ProjectedNode {
  const node = value as Record<string, unknown>;
  return {
    ...node,
    content: (node.content as readonly { content: { $case: "text" | "inlineReference"; value: unknown } }[]).map(
      (wrapper): NodeContentItem =>
        ({
          ...(wrapper.content.value as Record<string, unknown>),
          kind: wrapper.content.$case === "text" ? "text" : "inline-reference",
        }) as NodeContentItem,
    ),
  } as unknown as ProjectedNode;
}

function withoutKind(value: NodeContentItem): Record<string, unknown> {
  const { kind: _kind, ...fields } = value;
  return fields;
}

function isStringListSection(section: ProjectionPageSection): boolean {
  return (
    section === "childOccurrences" ||
    section === "supertagApplications" ||
    section === "supertagFields" ||
    section === "supertagTemplateNodes" ||
    section === "supertagExtensions" ||
    section === "supertagInstanceSupertags" ||
    section === "supertagExtensionConflicts"
  );
}

function toTemplateField(field: TemplateField): Record<string, unknown> {
  return {
    ...field,
    configCandidates: field.configCandidates.map(toFieldConfigCandidate),
    effectiveConfig: field.effectiveConfig === null ? null : toSupertagFieldConfig(field.effectiveConfig),
  };
}

function fromTemplateField(value: unknown): TemplateField {
  const field = value as Record<string, unknown>;
  return {
    ...field,
    configCandidates: (field.configCandidates as readonly unknown[]).map(fromFieldConfigCandidate),
    effectiveConfig: field.effectiveConfig === null ? null : fromSupertagFieldConfig(field.effectiveConfig),
  } as unknown as TemplateField;
}

function toEffectiveField(field: EffectiveField): Record<string, unknown> {
  return {
    ...field,
    configCandidates: field.configCandidates.map(toFieldConfigCandidate),
    effectiveConfig: field.effectiveConfig === null ? null : toSupertagFieldConfig(field.effectiveConfig),
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
    effectiveConfig: field.effectiveConfig === null ? null : fromSupertagFieldConfig(field.effectiveConfig),
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
  return { ...candidate, config: toSupertagFieldConfig(candidate.config) };
}

function fromFieldConfigCandidate(value: unknown): FieldConfigCandidate {
  const candidate = value as Record<string, unknown>;
  return { ...candidate, config: fromSupertagFieldConfig(candidate.config) } as FieldConfigCandidate;
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
