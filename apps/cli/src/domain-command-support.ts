import type { DesktopClient } from "@lode/desktop-client";
import type { EditMutation, EngineCommand, EngineQuery, SearchExpressionSpec, ViewOptionsSpec } from "@lode/sdk";

export const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

export function mutationCommand(
  workspaceId: string,
  argv: readonly string[],
  action: string,
  mutations: readonly EditMutation[],
): Extract<EngineCommand, { kind: "mutate" }> {
  return {
    kind: "mutate",
    workspaceId,
    invocationId: invocation(argv, action),
    actorId: actor(argv),
    intent: argv.includes("--proposal") ? "proposal" : "direct",
    historyChannelId: channel(argv),
    mutations,
  };
}

export function searchExpression(argv: readonly string[], expressionNodeId: string): SearchExpressionSpec {
  const clauses: SearchExpressionSpec[] = [];
  const add = (clause: Record<string, unknown>): void => {
    clauses.push({
      expressionNodeId: `${expressionNodeId}-clause-${clauses.length + 1}`,
      ...clause,
    } as SearchExpressionSpec);
  };
  for (const tag of flags(argv, "--tag")) {
    add({ kind: "supertag", supertagId: tag });
  }
  for (const text of flags(argv, "--text")) {
    add({ kind: "text", text });
  }
  for (const text of flags(argv, "--not-text")) {
    add({
      kind: "not",
      operand: { expressionNodeId: `${expressionNodeId}-not-${clauses.length + 1}`, kind: "text", text },
    });
  }
  for (const fieldDefinitionId of flags(argv, "--field-defined")) {
    add({ kind: "field-defined", fieldDefinitionId, defined: true });
  }
  for (const input of flags(argv, "--field-value")) {
    const [fieldDefinitionId, value] = pair(input, "Field value", "=");
    add({ kind: "field-value", fieldDefinitionId, value: { kind: "text", value } });
  }
  for (const input of flags(argv, "--date-lt")) {
    const [fieldDefinitionId, date] = pair(input, "Date comparison", "=");
    add({ kind: "date-compare", fieldDefinitionId, operator: "lt", date });
  }
  for (const input of flags(argv, "--date-gt")) {
    const [fieldDefinitionId, date] = pair(input, "Date comparison", "=");
    add({ kind: "date-compare", fieldDefinitionId, operator: "gt", date });
  }
  for (const targetNodeId of flags(argv, "--links-to")) {
    add({ kind: "links-to", targetNodeId });
  }
  for (const nodeId of flags(argv, "--descendant-of")) {
    add({ kind: "descendant-of", target: { kind: "node", nodeId } });
  }
  if (clauses.length === 0) {
    throw new Error("Search requires at least one query flag");
  }
  const onlyClause = clauses[0];
  if (clauses.length === 1 && onlyClause !== undefined) {
    return { ...onlyClause, expressionNodeId };
  }
  return { expressionNodeId, kind: "and", operands: clauses };
}

export function viewOptions(argv: readonly string[], viewDefinitionNodeId: string): ViewOptionsSpec {
  const columns = (optionalFlag(argv, "--columns") ?? "")
    .split(",")
    .filter((value) => value.length > 0)
    .map((fieldDefinitionId, index) => ({
      columnNodeId: `${viewDefinitionNodeId}-column-${index + 1}`,
      fieldDefinitionId,
    }));
  const filterInput = optionalFlag(argv, "--filter-field");
  const filter =
    filterInput === undefined
      ? null
      : (() => {
          const [fieldDefinitionId, value] = pair(filterInput, "View Filter", "=");
          return {
            filterNodeId: `${viewDefinitionNodeId}-filter`,
            expression: {
              expressionNodeId: `${viewDefinitionNodeId}-filter-expression`,
              kind: "field-value" as const,
              fieldDefinitionId,
              value: { kind: "text" as const, value },
            },
          };
        })();
  const sortInput = optionalFlag(argv, "--sort");
  const sort =
    sortInput === undefined
      ? null
      : (() => {
          const [fieldDefinitionId, direction] = pair(sortInput, "View Sort", ":");
          if (direction !== "ascending" && direction !== "descending") {
            throw new Error("View Sort direction must be ascending or descending");
          }
          return { sortNodeId: `${viewDefinitionNodeId}-sort`, fieldDefinitionId, direction } as const;
        })();
  const groupFieldDefinitionId = optionalFlag(argv, "--group");
  return {
    columns,
    filter,
    sort,
    group:
      groupFieldDefinitionId === undefined
        ? null
        : { groupNodeId: `${viewDefinitionNodeId}-group`, fieldDefinitionId: groupFieldDefinitionId },
  };
}

export async function projection(
  client: DesktopClient,
  workspaceId: string,
  section: NonNullable<Extract<EngineQuery, { kind: "projection" }>["section"]>,
): Promise<Record<string, unknown>> {
  const collected: Record<string, unknown> = {};
  let after: string | undefined;
  do {
    const result = await client.query({
      kind: "projection",
      workspaceId,
      perspective: "origin",
      section,
      after,
      limit: 100,
    });
    if (result.status !== "ok") {
      throw new Error(result.error.message);
    }
    const page = result.value as unknown as Record<string, unknown>;
    Object.assign(collected, page[section] as Record<string, unknown>);
    after = typeof page.next === "string" ? page.next : undefined;
  } while (after !== undefined);
  return collected;
}

export function datatypeNodeId(value: string): string {
  const supported = new Set(["plain", "options", "options-from-supertag", "number", "checkbox", "date"]);
  if (!supported.has(value)) {
    throw new Error(`Unsupported Field datatype: ${value}`);
  }
  return `system-field-datatype:v1:${value}`;
}

export function nodeType(value: string) {
  if (
    value !== "supertag-definition" &&
    value !== "field-definition" &&
    value !== "field" &&
    value !== "search" &&
    value !== "command" &&
    value !== "workspace" &&
    value !== "calendar"
  ) {
    throw new Error(`Unknown intrinsic Node type: ${value}`);
  }
  return value;
}

export function perspective(argv: readonly string[]): "origin" | "review" {
  return optionalFlag(argv, "--perspective") === "review" ? "review" : "origin";
}

export function actor(argv: readonly string[]): string {
  return optionalFlag(argv, "--actor") ?? "lode-user";
}

export function channel(argv: readonly string[]): string {
  return optionalFlag(argv, "--channel") ?? "lode-cli";
}

export function invocation(argv: readonly string[], action: string): string {
  return optionalFlag(argv, "--invocation") ?? `${action}-${Date.now().toString(36)}`;
}

export function integerFlag(argv: readonly string[], name: string): number | undefined {
  const value = optionalFlag(argv, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function optionalFlag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : required(argv[index + 1], `${name} value`);
}

export function requiredFlag(argv: readonly string[], name: string): string {
  return required(optionalFlag(argv, name), `${name} value`);
}

export function finiteNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Number Field value must be finite");
  }
  return parsed;
}

export function booleanInput(value: string): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error("Checkbox Field value must be true or false");
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

export function required<T>(value: T | undefined, label: string): T {
  if (value === undefined || value === "") {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function flags(argv: readonly string[], name: string): readonly string[] {
  return argv.flatMap((value, index) => (value === name ? [required(argv[index + 1], `${name} value`)] : []));
}

function pair(value: string, label: string, separator: string): readonly [string, string] {
  const index = value.indexOf(separator);
  if (index <= 0 || index === value.length - 1) {
    throw new Error(`${label} must use <left>${separator}<right>`);
  }
  return [value.slice(0, index), value.slice(index + separator.length)];
}
