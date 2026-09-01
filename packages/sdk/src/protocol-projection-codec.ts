import type { ProjectionPage as ProtocolProjectionPage } from "@lode/protocol/proto";

import type {
  ProjectionPage,
  ProjectionPageSection,
  SharedDefaultViewDefinition,
  SupertagApplication,
  SearchExpression,
} from "./projection.js";
import type { ConflictIssue } from "./review.js";
import { required, selectedCase, unsupportedProtocolValue } from "./protocol-decoding.js";
import { fromConflictIssue, toConflictIssue } from "./protocol-conflict-codec.js";
import { fromProtocolValue } from "./protocol-value-codec.js";
import {
  fromFieldDefinitionConfiguration,
  toFieldDefinitionConfiguration,
} from "./protocol-field-definition-configuration-codec.js";
import {
  fromEffectiveField,
  fromOptionalFieldSuggestion,
  toEffectiveField,
  toOptionalFieldSuggestion,
} from "./protocol-effective-field-codec.js";
import { fromSearchExpressionSpec, toSearchExpressionSpec } from "./protocol-search-expression-codec.js";
import { fromViewOptionsSpec, toViewOptionsSpec } from "./protocol-view-options-codec.js";
import {
  fromProjectedNode,
  fromTypedFieldValue,
  toProjectedNode,
  toTypedFieldValue,
} from "./protocol-projected-value-codec.js";

type ProtocolProjectionPageSection = Exclude<ProtocolProjectionPage["content"]["case"], undefined>;

export function toProjectionPage(page: ProjectionPage): Record<string, unknown> {
  const section = page.section;
  return {
    identity: page.identity,
    perspective: page.perspective,
    next: page.next,
    content: {
      case: section,
      value: projectionSectionToProtocol(section, (page as unknown as Record<string, unknown>)[section]),
    },
  };
}

export function fromProjectionPage(value: unknown): ProjectionPage {
  const page = value as Record<string, unknown> & Pick<ProtocolProjectionPage, "content">;
  const content = selectedCase(page.content, "Projection page");
  return {
    identity: required(fromProtocolValue(page.identity), "Projection identity"),
    perspective: page.perspective,
    section: content.case,
    next: page.next,
    [content.case]: projectionSectionFromProtocol(content.case, content.value),
  } as ProjectionPage;
}

function projectionSectionToProtocol(section: ProjectionPageSection, value: unknown): Record<string, unknown> {
  const entries = value as Readonly<Record<string, unknown>>;
  switch (section) {
    case "templateNodeInstances":
      return { values: value };
    case "childOccurrences":
    case "supertagTemplateNodes":
    case "supertagExtensions":
    case "supertagInstanceSupertags":
    case "supertagExtensionConflicts":
    case "materializedFields":
    case "templateFields":
    case "optionalFieldContributions":
      return { values: mapValues(entries, (item) => ({ values: item })) };
    case "supertagApplications":
      return { values: mapValues(entries, (item) => ({ values: item as readonly SupertagApplication[] })) };
    case "optionalFieldSuggestions":
      return wrappedLists(entries, toOptionalFieldSuggestion);
    case "effectiveFields":
      return wrappedLists(entries, toEffectiveField);
    case "typedFieldValues":
      return wrappedLists(entries, toTypedFieldValue);
    case "fieldDefinitionConfigurations":
      return wrappedLists(entries, toFieldDefinitionConfiguration);
    case "searchExpressions":
      return { values: mapValues(entries, encodeSearchExpression) };
    case "sharedDefaultViewDefinitions":
      return wrappedLists(entries, (definition: SharedDefaultViewDefinition) => ({
        ...definition,
        options: toViewOptionsSpec(definition.options),
      }));
    case "conflictIssues":
      return { values: mapValues(entries, (item) => toConflictIssue(item as ConflictIssue)) };
    case "nodes":
      return { values: mapValues(entries, (item) => toProjectedNode(item as Parameters<typeof toProjectedNode>[0])) };
    case "occurrences":
    case "nodeOwners":
    case "workspaceSystemNodes":
    case "metanodes":
      return { values: entries };
    default:
      return unsupportedProtocolValue(section, "Projection page section");
  }
}

function projectionSectionFromProtocol(section: ProtocolProjectionPageSection, value: unknown): unknown {
  const wrapper = value as { values: unknown };
  const entries = wrapper.values as Readonly<Record<string, unknown>>;
  switch (section) {
    case "templateNodeInstances":
      return wrapper.values;
    case "childOccurrences":
    case "supertagTemplateNodes":
    case "supertagExtensions":
    case "supertagInstanceSupertags":
    case "supertagExtensionConflicts":
    case "materializedFields":
    case "supertagApplications":
    case "templateFields":
    case "optionalFieldContributions":
      return mapValues(entries, unwrapValues);
    case "optionalFieldSuggestions":
      return unwrapLists(entries, fromOptionalFieldSuggestion);
    case "effectiveFields":
      return unwrapLists(entries, fromEffectiveField);
    case "typedFieldValues":
      return unwrapLists(entries, fromTypedFieldValue);
    case "fieldDefinitionConfigurations":
      return unwrapLists(entries, fromFieldDefinitionConfiguration);
    case "searchExpressions":
      return mapValues(entries, decodeSearchExpression);
    case "sharedDefaultViewDefinitions":
      return unwrapLists(entries, (definition) => {
        const fields = definition as Record<string, unknown>;
        return { ...fields, options: fromViewOptionsSpec(fields.options) };
      });
    case "conflictIssues":
      return mapValues(entries, fromConflictIssue);
    case "nodes":
      return mapValues(entries, fromProjectedNode);
    case "occurrences":
    case "nodeOwners":
    case "workspaceSystemNodes":
    case "metanodes":
      return entries;
    default:
      return unsupportedProtocolValue(section, "Projection page section");
  }
}

function mapValues(
  value: Readonly<Record<string, unknown>>,
  transform: (item: unknown) => unknown,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item)]));
}

function wrappedLists<Item>(
  entries: Readonly<Record<string, unknown>>,
  transform: (item: Item) => unknown,
): Record<string, unknown> {
  return {
    values: mapValues(entries, (item) => ({ values: (item as readonly Item[]).map(transform) })),
  };
}

function unwrapLists(
  entries: Readonly<Record<string, unknown>>,
  transform: (item: unknown) => unknown,
): Record<string, unknown> {
  return mapValues(entries, (item) => (item as { values: readonly unknown[] }).values.map(transform));
}

function unwrapValues(item: unknown): unknown {
  return (item as { values: unknown }).values;
}

function encodeSearchExpression(item: unknown): Record<string, unknown> {
  const expression = item as SearchExpression;
  return { ...expression, expression: toSearchExpressionSpec(expression.expression) };
}

function decodeSearchExpression(item: unknown): Record<string, unknown> {
  const expression = item as Record<string, unknown>;
  return { ...expression, expression: fromSearchExpressionSpec(expression.expression) };
}
