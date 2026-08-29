import { END_SEQUENCE_ANCHOR as end } from "@lode/sdk";
import type { EditAction, SearchExpressionDraft, SearchExpressionSpec, SearchResultsResult } from "@lode/sdk";

import { CliError, okOutcome, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition, ProductCommandRun } from "../catalog/index.js";
import { descriptor, labelOf, readNodeUniverse, resolveNodeTarget } from "../target/index.js";
import { executeWrite, identity, writeResult, workspaceIdOf } from "../intent/index.js";
import { parseExpression } from "../value/expression.js";
import { compileDraft, renderExpression, renderSpec, resolveAst } from "../value/expression-compile.js";

/**
 * Search family: persistent Search Nodes over the shared evaluator. The CLI
 * owns only the expression language — parsing, target resolution, and
 * semantic compilation. Expression identities are assigned by the Fact authority.
 */

export function registerSearchCommands(catalog: CommandCatalog): void {
  catalog.register(searchCreate);
  catalog.register(searchShow);
  catalog.register(searchEdit);
  catalog.register(searchResults);
}

const WHERE = { name: "--where", description: "Filter expression", value: { kind: "string" as const } };

async function compileExpression(
  context: Parameters<ProductCommandRun>[0],
  raw: string,
): Promise<Readonly<{ draft: SearchExpressionDraft; rendered: string }>> {
  const workspaceId = workspaceIdOf(context);
  const ast = parseExpression(raw);
  const resolved = await resolveAst(ast, async (token, role) => {
    const target = await resolveNodeTarget(context.session, workspaceId, context.perspective, token, [role]);
    return target.nodeId;
  });
  return { draft: compileDraft(resolved), rendered: renderExpression(resolved) };
}

const searchCreate: CommandDefinition = {
  path: ["search", "create"],
  summary: "Create a persistent Search Node.",
  positionals: [["name", "Search name"]],
  options: [{ ...WHERE, required: true }],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const name = args.positional("name");
    const expression = await compileExpression(context, args.requiredOption("--where"));
    const searchNodeId = identity(context.requestId, "search");
    const actions: readonly EditAction[] = [
      {
        kind: "node-create",
        nodeId: searchNodeId,
        occurrenceId: `${searchNodeId}-original`,
        parentNodeId: workspaceId,
        anchor: end,
        intrinsicNodeType: "search",
        seed: { text: [{ value: name, attributes: {} }] },
      },
      {
        kind: "search-expression-create",
        searchNodeId,
        expression: expression.draft,
        anchor: end,
      },
    ];
    const { result, data } = await executeWrite(context, "search.create", actions);
    const resource = descriptor(workspaceId, "search", searchNodeId, name);
    return writeResult(data, result, {
      extra: { target: resource, expression: expression.rendered },
      view: writeView("Created", resource, `matching ${expression.rendered}`),
    });
  },
};

const searchShow: CommandDefinition = {
  path: ["search", "show"],
  summary: "Show a Search Node's persistent expression.",
  positionals: [["search", "Search target"]],
  options: [],
  kind: "read",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.positional("search"),
      ["search"],
    );
    const expressions = (await context.session.readProjection(
      workspaceId,
      context.perspective,
      "searchExpressions",
    )) as Record<string, { expressionNodeId: string; expression: SearchExpressionSpec }>;
    const current = expressions[target.nodeId];
    if (current === undefined) {
      throw new CliError("unsupported", `Search ${target.descriptor.ref} has no expression in this projection.`);
    }
    return okOutcome(
      {
        resource: target.descriptor,
        expression: renderSpec(current.expression),
        expressionNodeId: current.expressionNodeId,
      },
      {
        view: {
          kind: "text",
          lines: [
            `Search ${target.label}`,
            `Ref: ${target.descriptor.ref}`,
            `Where: ${renderSpec(current.expression)}`,
          ],
        },
      },
    );
  },
};

const searchEdit: CommandDefinition = {
  path: ["search", "edit"],
  summary: "Replace a Search Node's expression.",
  positionals: [["search", "Search target"]],
  options: [{ ...WHERE, required: true }],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.positional("search"),
      ["search"],
    );
    const expressions = (await context.session.readProjection(
      workspaceId,
      context.perspective,
      "searchExpressions",
    )) as Record<string, { expressionNodeId: string; expression: SearchExpressionSpec }>;
    const current = expressions[target.nodeId];
    if (current === undefined) {
      throw new CliError("unsupported", `Search ${target.descriptor.ref} has no expression in this projection.`);
    }
    const expression = await compileExpression(context, args.requiredOption("--where"));
    const { result, data } = await executeWrite(context, "search.edit", [
      {
        kind: "search-expression-remove",
        searchNodeId: target.nodeId,
        expressionId: current.expression.expressionId,
      },
      { kind: "search-expression-create", searchNodeId: target.nodeId, expression: expression.draft, anchor: end },
    ]);
    return writeResult(data, result, {
      extra: { target: target.descriptor, expression: expression.rendered },
      view: writeView("Updated", target.descriptor, `to ${expression.rendered}`),
    });
  },
};

const searchResults: CommandDefinition = {
  path: ["search", "results"],
  summary: "Read a Search Node's current result rows.",
  positionals: [["search", "Search target"]],
  options: [],
  kind: "read",
  paginated: true,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.positional("search"),
      ["search"],
    );
    const result = await context.session.application.query({
      kind: "search-results",
      workspaceId,
      perspective: context.perspective,
      searchNodeId: target.nodeId,
      limit: context.limit,
      after: context.cursor,
    });
    if (result.status !== "ok") {
      throw new CliError("unavailable", `Search results are unavailable: ${result.error.message}`);
    }
    const results = result.value as unknown as SearchResultsResult;
    const { nodes } = await readNodeUniverse(context.session, workspaceId, context.perspective);
    return okOutcome(
      {
        resource: target.descriptor,
        items: results.results.map((row) =>
          descriptor(workspaceId, "node", row.targetNodeId, labelOf(nodes, row.targetNodeId)),
        ),
      },
      {
        view: {
          kind: "table",
          columns: ["label", "ref"],
          rows: results.results.map((row) => [labelOf(nodes, row.targetNodeId), `node:${row.targetNodeId}`]),
        },
        page: { count: results.results.length, next: results.next },
      },
    );
  },
};
