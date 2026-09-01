import { END_SEQUENCE_ANCHOR as end } from "@lode/sdk";
import type { EditAction, SearchExpressionDraft } from "@lode/sdk";

import { CliError, okOutcome, writeView } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { readCommand, stringOption, writeCommand, type ProductCommandRun } from "../command/index.js";
import { labelOf, readNodeUniverse, resolveTarget, resource } from "../target/index.js";
import { identity, runWrite, workspaceIdOf } from "../intent/index.js";
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

const WHERE = stringOption("--where", "Filter expression");

async function compileExpression(
  context: Parameters<ProductCommandRun>[0],
  raw: string,
): Promise<Readonly<{ draft: SearchExpressionDraft; rendered: string }>> {
  const ast = parseExpression(raw);
  const resolved = await resolveAst(ast, async (token, role) => {
    const target = await resolveTarget(context, token, [role]);
    return target.nodeId;
  });
  return { draft: compileDraft(resolved), rendered: renderExpression(resolved) };
}

const searchCreate = writeCommand({
  path: ["search", "create"],
  summary: "Create a persistent Search Node.",
  positionals: [["name", "Search name"]],
  options: [{ ...WHERE, required: true }],
  run: runWrite("search.create", async (context, args) => {
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
    const created = resource(context, "search", searchNodeId, name);
    return {
      actions,
      extra: { target: created, expression: expression.rendered },
      view: writeView("Created", created, `matching ${expression.rendered}`),
    };
  }),
});

const searchShow = readCommand({
  path: ["search", "show"],
  summary: "Show a Search Node's persistent expression.",
  positionals: [["search", "Search target"]],
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveTarget(context, args.positional("search"), ["search"]);
    const expressions = await context.session.readProjection(workspaceId, context.perspective, "searchExpressions");
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
});

const searchEdit = writeCommand({
  path: ["search", "edit"],
  summary: "Replace a Search Node's expression.",
  positionals: [["search", "Search target"]],
  options: [{ ...WHERE, required: true }],
  run: runWrite("search.edit", async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveTarget(context, args.positional("search"), ["search"]);
    const expressions = await context.session.readProjection(workspaceId, context.perspective, "searchExpressions");
    const current = expressions[target.nodeId];
    if (current === undefined) {
      throw new CliError("unsupported", `Search ${target.descriptor.ref} has no expression in this projection.`);
    }
    const expression = await compileExpression(context, args.requiredOption("--where"));
    return {
      actions: [
        {
          kind: "search-expression-remove",
          searchNodeId: target.nodeId,
          expressionId: current.expression.expressionId,
        },
        { kind: "search-expression-create", searchNodeId: target.nodeId, expression: expression.draft, anchor: end },
      ],
      extra: { target: target.descriptor, expression: expression.rendered },
      view: writeView("Updated", target.descriptor, `to ${expression.rendered}`),
    };
  }),
});

const searchResults = readCommand({
  path: ["search", "results"],
  summary: "Read a Search Node's current result rows.",
  positionals: [["search", "Search target"]],
  paginated: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveTarget(context, args.positional("search"), ["search"]);
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
    const results = result.value;
    const { nodes } = await readNodeUniverse(context.session, workspaceId, context.perspective);
    return okOutcome(
      {
        resource: target.descriptor,
        items: results.results.map((row) =>
          resource(context, "node", row.targetNodeId, labelOf(nodes, row.targetNodeId)),
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
});
