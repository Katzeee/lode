import { END_SEQUENCE_ANCHOR as end } from "@lode/sdk";
import type { EditAction, SupertagInstancesResult } from "@lode/sdk";

import { CliError, okOutcome, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";
import { descriptor, labelOf, readNodeUniverse, resolveNodeTarget } from "../target/index.js";
import { executeWrite, writeResult, workspaceIdOf } from "../intent/index.js";

const supertagInstances: CommandDefinition = {
  path: ["supertag", "instances"],
  summary: "List nodes applying a Supertag directly or through extensions.",
  positionals: [["supertag", "Supertag target"]],
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
      args.positional("supertag"),
      ["supertag"],
    );
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
    const instances = result.value as unknown as SupertagInstancesResult;
    const { nodes } = await readNodeUniverse(context.session, workspaceId, context.perspective);
    return okOutcome(
      {
        resource: target.descriptor,
        items: instances.nodeIds.map((nodeId) => descriptor(workspaceId, "node", nodeId, labelOf(nodes, nodeId))),
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
};

const supertagExtend: CommandDefinition = {
  path: ["supertag", "extend"],
  summary: "Make a Supertag extend a base Supertag.",
  positionals: [["supertag", "Deriving Supertag target"]],
  options: [
    { name: "--with", description: "Base Supertag target", value: { kind: "string" as const }, required: true },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const supertag = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.positional("supertag"),
      ["supertag"],
    );
    const base = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.requiredOption("--with"),
      ["supertag"],
    );
    const actions: readonly EditAction[] = [
      { kind: "supertag-extension-add", supertagId: supertag.nodeId, baseSupertagId: base.nodeId, anchor: end },
    ];
    const { result, data } = await executeWrite(context, "supertag.extend", actions);
    return writeResult(data, result, {
      extra: { target: supertag.descriptor, with: base.descriptor },
      view: writeView("Extended", supertag.descriptor, `with ${base.label}`),
    });
  },
};

const supertagUnextend: CommandDefinition = {
  path: ["supertag", "unextend"],
  summary: "Remove a Supertag extension.",
  positionals: [["supertag", "Deriving Supertag target"]],
  options: [
    { name: "--with", description: "Base Supertag target", value: { kind: "string" as const }, required: true },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const supertag = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.positional("supertag"),
      ["supertag"],
    );
    const base = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.requiredOption("--with"),
      ["supertag"],
    );
    const extensions = (await context.session.readProjection(
      workspaceId,
      context.perspective,
      "supertagExtensions",
    )) as Record<string, string[]>;
    if (!(extensions[supertag.nodeId] ?? []).includes(base.nodeId)) {
      throw new CliError(
        "target-not-found",
        `Supertag ${supertag.descriptor.ref} does not extend ${base.descriptor.ref}.`,
      );
    }
    const actions: readonly EditAction[] = [
      { kind: "supertag-extension-remove", supertagId: supertag.nodeId, baseSupertagId: base.nodeId },
    ];
    const { result, data } = await executeWrite(context, "supertag.unextend", actions);
    return writeResult(data, result, {
      extra: { target: supertag.descriptor, with: base.descriptor },
      view: writeView("Unextended", supertag.descriptor, `from ${base.label}`),
    });
  },
};

export function registerSupertagRelationCommands(catalog: CommandCatalog): void {
  catalog.register(supertagInstances);
  catalog.register(supertagExtend);
  catalog.register(supertagUnextend);
}
