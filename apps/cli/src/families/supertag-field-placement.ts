import type { EditMutation } from "@lode/sdk";

import { CliError, writeView } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition, ProductCommandRun } from "../catalog/index.js";
import { resolveNodeTarget } from "../target/index.js";
import { executeWrite, identity, writeResult, workspaceIdOf } from "../intent/index.js";
import { readOptionalContributions, readTemplateFields } from "./supertag-field.js";
import { optionalContributionMutations } from "./supertag-field-mutations.js";

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;
const BOOLEAN_ENUM = ["true", "false"] as const;

const fieldRemove: CommandDefinition = {
  path: ["supertag", "field", "remove"],
  summary: "Remove a template field use; the field definition and instance content stay.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    { name: "--field", description: "Field Definition target", value: { kind: "string" as const }, required: true },
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
    const field = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.requiredOption("--field"),
      ["field"],
    );
    const use = (await readTemplateFields(context, supertag.nodeId)).find(
      (candidate) => candidate.fieldDefinitionId === field.nodeId,
    );
    if (use === undefined) {
      const contribution = (await readOptionalContributions(context, supertag.nodeId)).find(
        (candidate) => candidate.fieldDefinitionId === field.nodeId,
      );
      if (contribution === undefined) {
        throw new CliError(
          "target-not-found",
          `Supertag ${supertag.descriptor.ref} does not expose field ${field.descriptor.ref}.`,
        );
      }
      const { result, data } = await executeWrite(context, "supertag.field.remove", [
        { kind: "node-delete", nodeId: contribution.contributionNodeId },
      ]);
      return writeResult(data, result, {
        extra: { target: supertag.descriptor, field: field.descriptor },
        view: writeView("Removed optional field", field.descriptor, `from ${supertag.label}`),
      });
    }
    const { result, data } = await executeWrite(context, "supertag.field.remove", [
      {
        kind: "supertag-template-field-remove",
        supertagId: supertag.nodeId,
        templateFieldNodeId: use.templateFieldNodeId,
      },
    ]);
    return writeResult(data, result, {
      extra: { target: supertag.descriptor, field: field.descriptor },
      view: writeView("Removed field", field.descriptor, `from ${supertag.label}`),
    });
  },
};

const fieldPin: CommandDefinition = {
  path: ["supertag", "field", "pin"],
  summary: "Mark a template field as a primary dimension.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    { name: "--field", description: "Field Definition target", value: { kind: "string" as const }, required: true },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: visibilitySet("pin", "pinned", "Pinned field"),
};

const fieldUnpin: CommandDefinition = {
  path: ["supertag", "field", "unpin"],
  summary: "Return a pinned template field to normal placement.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    { name: "--field", description: "Field Definition target", value: { kind: "string" as const }, required: true },
  ],
  kind: "write",
  paginated: false,
  needsWorkspace: true,
  run: visibilitySet("unpin", "normal", "Unpinned field"),
};

function visibilitySet(action: string, visibility: "pinned" | "normal", verb: string) {
  return async (context: Parameters<ProductCommandRun>[0], args: Parameters<ProductCommandRun>[1]) => {
    const workspaceId = workspaceIdOf(context);
    const supertag = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.positional("supertag"),
      ["supertag"],
    );
    const field = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.requiredOption("--field"),
      ["field"],
    );
    const use = (await readTemplateFields(context, supertag.nodeId)).find(
      (candidate) => candidate.fieldDefinitionId === field.nodeId,
    );
    if (use === undefined) {
      throw new CliError(
        "target-not-found",
        `Supertag ${supertag.descriptor.ref} does not have field ${field.descriptor.ref} in its template.`,
      );
    }
    const { result, data } = await executeWrite(context, `supertag.field.${action}`, [
      {
        kind: "supertag-template-field-visibility-set",
        supertagId: supertag.nodeId,
        templateFieldNodeId: use.templateFieldNodeId,
        visibility,
      },
    ]);
    return writeResult(data, result, {
      extra: { target: supertag.descriptor, field: field.descriptor },
      view: writeView(verb, field.descriptor, `on ${supertag.label}`),
    });
  };
}

const fieldSetOptional: CommandDefinition = {
  path: ["supertag", "field", "set-optional"],
  summary: "Move a field between the template and the Optional Field Contribution section.",
  positionals: [["supertag", "Supertag target"]],
  options: [
    { name: "--field", description: "Field Definition target", value: { kind: "string" as const }, required: true },
    {
      name: "--value",
      description: "true to make optional, false to return to template",
      value: { kind: "enum" as const, enum: BOOLEAN_ENUM },
      required: true,
    },
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
    const field = await resolveNodeTarget(
      context.session,
      workspaceId,
      context.perspective,
      args.requiredOption("--field"),
      ["field"],
    );
    const makeOptional = args.requiredOption("--value") === "true";
    const templateUse = (await readTemplateFields(context, supertag.nodeId)).find(
      (candidate) => candidate.fieldDefinitionId === field.nodeId,
    );
    const contribution = (await readOptionalContributions(context, supertag.nodeId)).find(
      (candidate) => candidate.fieldDefinitionId === field.nodeId,
    );
    const mutations: EditMutation[] = [];
    if (makeOptional) {
      if (templateUse === undefined) {
        throw new CliError(
          "unsupported",
          `Field ${field.descriptor.ref} is not a template field of ${supertag.descriptor.ref}.`,
        );
      }
      mutations.push({
        kind: "supertag-template-field-remove",
        supertagId: supertag.nodeId,
        templateFieldNodeId: templateUse.templateFieldNodeId,
      });
      mutations.push(...optionalContributionMutations(context.requestId, supertag.nodeId, field.nodeId, {}));
    } else {
      if (contribution === undefined) {
        throw new CliError(
          "unsupported",
          `Field ${field.descriptor.ref} is not an optional contribution of ${supertag.descriptor.ref}.`,
        );
      }
      mutations.push({ kind: "node-delete", nodeId: contribution.contributionNodeId });
      mutations.push({
        kind: "supertag-template-field-add-existing",
        supertagId: supertag.nodeId,
        templateFieldNodeId: identity(context.requestId, "template-field"),
        templateFieldOccurrenceId: identity(context.requestId, "template-field-occurrence"),
        fieldDefinitionId: field.nodeId,
        definitionOccurrenceId: identity(context.requestId, "definition-occurrence"),
        staticDefaultValueNodeId: identity(context.requestId, "default-node"),
        staticDefaultValueOccurrenceId: identity(context.requestId, "default-occurrence"),
        anchor: end,
      });
    }
    const { result, data } = await executeWrite(context, "supertag.field.set-optional", mutations);
    return writeResult(data, result, {
      extra: { target: supertag.descriptor, field: field.descriptor },
      view: writeView(
        makeOptional ? "Made field optional" : "Returned field to template",
        field.descriptor,
        `on ${supertag.label}`,
      ),
    });
  },
};

export function registerSupertagFieldPlacementCommands(catalog: CommandCatalog): void {
  catalog.register(fieldRemove);
  catalog.register(fieldPin);
  catalog.register(fieldUnpin);
  catalog.register(fieldSetOptional);
}
