import type { SearchExpressionDraft, SearchExpressionSpec } from "@lode/sdk";
import type { ExpressionAst } from "./expression.js";

/** Compiles the CLI expression language into the semantic draft accepted by Search and View edits. */
export function compileDraft(ast: ExpressionAst): SearchExpressionDraft {
  switch (ast.kind) {
    case "and":
    case "or":
      return {
        kind: ast.kind,
        operands: ast.operands.map(compileDraft),
      };
    case "not":
      return { kind: "not", operand: compileDraft(ast.operand) };
    case "supertag":
      return { kind: "supertag", supertagId: ast.target };
    case "text":
      return { kind: "text", text: ast.text };
    case "field-defined":
      return { kind: "field-defined", fieldDefinitionId: ast.target, defined: ast.defined };
    case "field-value":
      return {
        kind: "field-value",
        fieldDefinitionId: ast.target,
        value: { kind: "text", value: ast.scalar },
      };
    case "date-compare":
      return {
        kind: "date-compare",
        fieldDefinitionId: ast.target,
        operator: ast.operator,
        date: ast.date,
      };
    case "child-of":
    case "descendant-of":
      return {
        kind: ast.kind,
        target:
          ast.target === "parent" || ast.target === "grandparent"
            ? ({ kind: ast.target } as const)
            : ({ kind: "node", nodeId: ast.target } as const),
      };
    case "links-to":
      return { kind: "links-to", targetNodeId: ast.target };
  }
}

/** Renders an AST back into the CLI expression language. */
export function renderExpression(ast: ExpressionAst): string {
  switch (ast.kind) {
    case "and":
    case "or":
      return ast.operands.map((operand) => wrapAst(operand, ast.kind)).join(ast.kind === "and" ? " and " : " or ");
    case "not":
      return `not ${wrapAst(ast.operand, "not")}`;
    case "supertag":
      return `tag(${quote(ast.target)})`;
    case "text":
      return `text(${quote(ast.text)})`;
    case "field-defined":
      return `${ast.defined ? "defined" : "undefined"}(${quote(ast.target)})`;
    case "field-value":
      return `field(${quote(ast.target)}) = ${quote(ast.scalar)}`;
    case "date-compare":
      return `date(${quote(ast.target)}) ${ast.operator === "lt" ? "<" : ">"} ${ast.date}`;
    case "child-of":
    case "descendant-of":
      return `${ast.kind}(${ast.target === "parent" || ast.target === "grandparent" ? ast.target : quote(ast.target)})`;
    case "links-to":
      return `links-to(${quote(ast.target)})`;
  }
}

function wrapAst(ast: ExpressionAst, parent: "and" | "or" | "not"): string {
  const needsParens =
    (parent === "not" && (ast.kind === "and" || ast.kind === "or")) ||
    (parent === "and" && ast.kind === "or") ||
    (parent === "or" && ast.kind === "and");
  const rendered = renderExpression(ast);
  return needsParens ? `(${rendered})` : rendered;
}

function quote(value: string): string {
  return /[\s()]/u.test(value) ? `"${value}"` : value;
}

/** Renders a stored spec back into the CLI expression language. */
export function renderSpec(spec: SearchExpressionSpec): string {
  switch (spec.kind) {
    case "and":
    case "or":
      return spec.operands.map((operand) => wrapSpec(operand, spec.kind)).join(spec.kind === "and" ? " and " : " or ");
    case "not":
      return `not ${wrapSpec(spec.operand, "not")}`;
    case "supertag":
      return `tag(${quote(spec.supertagId)})`;
    case "text":
      return `text(${quote(spec.text)})`;
    case "field-defined":
      return `${spec.defined ? "defined" : "undefined"}(${quote(spec.fieldDefinitionId)})`;
    case "field-value":
      return `field(${quote(spec.fieldDefinitionId)}) = ${quote(scalarText(spec.value))}`;
    case "date-compare":
      return `date(${quote(spec.fieldDefinitionId)}) ${spec.operator === "lt" ? "<" : ">"} ${spec.date}`;
    case "child-of":
    case "descendant-of":
      return `${spec.kind}(${spec.target.kind === "node" ? quote(spec.target.nodeId) : spec.target.kind})`;
    case "links-to":
      return `links-to(${quote(spec.targetNodeId)})`;
  }
}

function wrapSpec(spec: SearchExpressionSpec, parent: "and" | "or" | "not"): string {
  const needsParens =
    (parent === "not" && (spec.kind === "and" || spec.kind === "or")) ||
    (parent === "and" && spec.kind === "or") ||
    (parent === "or" && spec.kind === "and");
  const rendered = renderSpec(spec);
  return needsParens ? `(${rendered})` : rendered;
}

type FieldScalar = Extract<SearchExpressionSpec, { kind: "field-value" }>["value"];

function scalarText(value: FieldScalar): string {
  if (value.kind === "node") {
    return value.nodeId;
  }
  if (value.kind === "text") {
    return value.value;
  }
  return String(value.value);
}

/** Resolves AST target tokens (labels/refs) into node identities. */
export async function resolveAst(
  ast: ExpressionAst,
  resolve: (token: string, role: "supertag" | "field" | "node") => Promise<string>,
): Promise<ExpressionAst> {
  switch (ast.kind) {
    case "and":
    case "or":
      return {
        kind: ast.kind,
        operands: await Promise.all(ast.operands.map((operand) => resolveAst(operand, resolve))),
      };
    case "not":
      return { kind: "not", operand: await resolveAst(ast.operand, resolve) };
    case "supertag":
      return { kind: "supertag", target: await resolve(ast.target, "supertag") };
    case "text":
      return ast;
    case "field-defined":
      return { kind: "field-defined", target: await resolve(ast.target, "field"), defined: ast.defined };
    case "field-value":
      return { kind: "field-value", target: await resolve(ast.target, "field"), scalar: ast.scalar };
    case "date-compare":
      return {
        kind: "date-compare",
        target: await resolve(ast.target, "field"),
        operator: ast.operator,
        date: ast.date,
      };
    case "child-of":
    case "descendant-of":
      return {
        kind: ast.kind,
        target:
          ast.target === "parent" || ast.target === "grandparent" ? ast.target : await resolve(ast.target, "node"),
      };
    case "links-to":
      return { kind: "links-to", target: await resolve(ast.target, "node") };
    default:
      return ast;
  }
}
