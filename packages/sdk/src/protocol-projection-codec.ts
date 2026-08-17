import type {
  ProjectionPage,
  ProjectionPageSection,
  ProjectedNode,
  NodeContentItem,
  SharedDefaultViewDefinition,
  FieldDefinitionConfiguration,
  SupertagApplication,
  TypedFieldValue,
  EffectiveField,
  OptionalFieldSuggestion,
  SearchExpression,
} from "./projection.js";
import type { ConflictIssue } from "./review.js";
import { fromConflictIssue, fromProtocolValue, required, toConflictIssue } from "./protocol-shape-codec.js";
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
  if (section === "supertagApplications") {
    return {
      values: mapValues(entries, (item) => ({ values: item as readonly SupertagApplication[] })),
    };
  }
  if (section === "materializedFields" || section === "templateFields" || section === "optionalFieldContributions") {
    return { values: mapValues(entries, (item) => ({ values: item })) };
  }
  if (section === "optionalFieldSuggestions") {
    return {
      values: mapValues(entries, (item) => ({
        values: (item as readonly OptionalFieldSuggestion[]).map(toOptionalFieldSuggestion),
      })),
    };
  }
  if (section === "effectiveFields") {
    return {
      values: mapValues(entries, (item) => ({
        values: (item as readonly EffectiveField[]).map(toEffectiveField),
      })),
    };
  }
  if (section === "typedFieldValues") {
    return {
      values: mapValues(entries, (item) => ({
        values: (item as readonly TypedFieldValue[]).map(toTypedFieldValue),
      })),
    };
  }
  if (section === "fieldDefinitionConfigurations") {
    return {
      values: mapValues(entries, (item) => ({
        values: (item as readonly FieldDefinitionConfiguration[]).map(toFieldDefinitionConfiguration),
      })),
    };
  }
  if (section === "searchExpressions") {
    return {
      values: mapValues(entries, (item) => {
        const expression = item as SearchExpression;
        return { ...expression, expression: toSearchExpressionSpec(expression.expression) };
      }),
    };
  }
  if (section === "sharedDefaultViewDefinitions") {
    return {
      values: mapValues(entries, (item) => ({
        values: (item as readonly SharedDefaultViewDefinition[]).map((definition) => ({
          ...definition,
          options: toViewOptionsSpec(definition.options),
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
  if (
    isStringListSection(section) ||
    section === "materializedFields" ||
    section === "supertagApplications" ||
    section === "templateFields" ||
    section === "optionalFieldContributions" ||
    section === "optionalFieldSuggestions"
  ) {
    if (section === "optionalFieldSuggestions") {
      return mapValues(entries, (item) =>
        (item as { values: readonly unknown[] }).values.map(fromOptionalFieldSuggestion),
      );
    }
    return mapValues(entries, (item) => (item as { values: unknown }).values);
  }
  if (section === "effectiveFields") {
    return mapValues(entries, (item) => (item as { values: readonly unknown[] }).values.map(fromEffectiveField));
  }
  if (section === "typedFieldValues") {
    return mapValues(entries, (item) => (item as { values: readonly unknown[] }).values.map(fromTypedFieldValue));
  }
  if (section === "fieldDefinitionConfigurations") {
    return mapValues(entries, (item) =>
      (item as { values: readonly unknown[] }).values.map(fromFieldDefinitionConfiguration),
    );
  }
  if (section === "searchExpressions") {
    return mapValues(entries, (item) => {
      const expression = item as Record<string, unknown>;
      return { ...expression, expression: fromSearchExpressionSpec(expression.expression) };
    });
  }
  if (section === "sharedDefaultViewDefinitions") {
    return mapValues(entries, (item) =>
      (item as { values: readonly Record<string, unknown>[] }).values.map((definition) => ({
        ...definition,
        options: fromViewOptionsSpec(definition.options),
      })),
    );
  }
  if (section === "conflictIssues") {
    return mapValues(entries, fromConflictIssue);
  }
  if (section === "nodes") {
    return mapValues(entries, fromProjectedNode);
  }
  return entries;
}

function toTypedFieldValue(value: TypedFieldValue): Record<string, unknown> {
  const { value: semantic, ...base } = value;
  if (semantic === null) {
    return { ...base, semanticValue: undefined };
  }
  const { kind, ...fields } = semantic;
  const $case =
    kind === "number"
      ? "numberValue"
      : kind === "date"
        ? "dateValue"
        : kind === "checkbox"
          ? "checkboxValue"
          : "optionsFromSupertagValue";
  return { ...base, semanticValue: { $case, value: fields } };
}

function fromTypedFieldValue(value: unknown): TypedFieldValue {
  const item = value as Record<string, unknown>;
  const { semanticValue, ...base } = item;
  if (base.state !== "value") {
    return { ...base, value: null } as TypedFieldValue;
  }
  const selected = required(
    semanticValue as {
      $case: "numberValue" | "dateValue" | "checkboxValue" | "optionsFromSupertagValue";
      value: unknown;
    } | null,
    "Typed Field semantic value",
  );
  const kind =
    selected.$case === "numberValue"
      ? "number"
      : selected.$case === "dateValue"
        ? "date"
        : selected.$case === "checkboxValue"
          ? "checkbox"
          : "options-from-supertag";
  return {
    ...base,
    state: "value",
    value: { kind, ...(selected.value as Record<string, unknown>) },
  } as TypedFieldValue;
}

export function toProjectedNode(node: ProjectedNode): Record<string, unknown> {
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

export function fromProjectedNode(value: unknown): ProjectedNode {
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
    section === "supertagTemplateNodes" ||
    section === "supertagExtensions" ||
    section === "supertagInstanceSupertags" ||
    section === "supertagExtensionConflicts"
  );
}

function mapValues(
  value: Readonly<Record<string, unknown>>,
  transform: (item: unknown) => unknown,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item)]));
}
