import { END_SEQUENCE_ANCHOR as end } from "@lode/sdk";
import type { EditAction } from "@lode/sdk";

import { CliError, okOutcome, writeView } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { readCommand, stringOption, writeCommand } from "../command/index.js";
import { labelOf, readNodeUniverse, resolveTarget, resource } from "../target/index.js";
import { runWrite, workspaceIdOf } from "../intent/index.js";

const supertagInstances = readCommand({
  path: ["supertag", "instances"],
  summary: "List nodes applying a Supertag directly or through extensions.",
  positionals: [["supertag", "Supertag target"]],
  paginated: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const target = await resolveTarget(context, args.positional("supertag"), ["supertag"]);
    const result = await context.session.application.query({
      kind: "supertag-instances",
      workspaceId,
      perspective: context.perspective,
      supertagId: target.nodeId,
      limit: context.limit,
      after: context.cursor,
    });
    if (result.status !== "ok") {
      throw new CliError("unavailable", `Supertag instances are unavailable: ${result.error.message}`);
    }
    const instances = result.value;
    const { nodes } = await readNodeUniverse(context.session, workspaceId, context.perspective);
    return okOutcome(
      {
        resource: target.descriptor,
        items: instances.nodeIds.map((nodeId) => resource(context, "node", nodeId, labelOf(nodes, nodeId))),
      },
      {
        view: {
          kind: "table",
          columns: ["label", "ref"],
          rows: instances.nodeIds.map((nodeId) => [labelOf(nodes, nodeId), `node:${nodeId}`]),
        },
        page: { count: instances.nodeIds.length, next: instances.next },
      },
    );
  },
});

const supertagExtend = writeCommand({
  path: ["supertag", "extend"],
  summary: "Make a Supertag extend a base Supertag.",
  positionals: [["supertag", "Deriving Supertag target"]],
  options: [stringOption("--with", "Base Supertag target", { required: true })],
  run: runWrite("supertag.extend", async (context, args) => {
    const supertag = await resolveTarget(context, args.positional("supertag"), ["supertag"]);
    const base = await resolveTarget(context, args.requiredOption("--with"), ["supertag"]);
    const actions: readonly EditAction[] = [
      { kind: "supertag-extension-add", supertagId: supertag.nodeId, baseSupertagId: base.nodeId, anchor: end },
    ];
    return {
      actions,
      extra: { target: supertag.descriptor, with: base.descriptor },
      view: writeView("Extended", supertag.descriptor, `with ${base.label}`),
    };
  }),
});

const supertagUnextend = writeCommand({
  path: ["supertag", "unextend"],
  summary: "Remove a Supertag extension.",
  positionals: [["supertag", "Deriving Supertag target"]],
  options: [stringOption("--with", "Base Supertag target", { required: true })],
  run: runWrite("supertag.unextend", async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const supertag = await resolveTarget(context, args.positional("supertag"), ["supertag"]);
    const base = await resolveTarget(context, args.requiredOption("--with"), ["supertag"]);
    const extensions = await context.session.readProjection(workspaceId, context.perspective, "supertagExtensions");
    if (!(extensions[supertag.nodeId] ?? []).includes(base.nodeId)) {
      throw new CliError(
        "target-not-found",
        `Supertag ${supertag.descriptor.ref} does not extend ${base.descriptor.ref}.`,
      );
    }
    const actions: readonly EditAction[] = [
      { kind: "supertag-extension-remove", supertagId: supertag.nodeId, baseSupertagId: base.nodeId },
    ];
    return {
      actions,
      extra: { target: supertag.descriptor, with: base.descriptor },
      view: writeView("Unextended", supertag.descriptor, `from ${base.label}`),
    };
  }),
});

export function registerSupertagRelationCommands(catalog: CommandCatalog): void {
  catalog.register(supertagInstances);
  catalog.register(supertagExtend);
  catalog.register(supertagUnextend);
}
