import type { EditAction, SharedDefaultViewDefinition, ViewOptionsSpec } from "@lode/sdk";

import type { ProductCommandRun } from "../command/index.js";
import { executeWrite, writeResult, workspaceIdOf } from "../intent/index.js";
import { CliError, writeView } from "../outcome/index.js";
import { resolveTarget, resource } from "../target/index.js";

type HostView = Readonly<{
  hostNodeId: string;
  hostLabel: string;
  viewId: SharedDefaultViewDefinition["viewId"];
  viewDefinitionNodeId: string;
  options: ViewOptionsSpec;
}>;

export async function readHostView(
  context: Parameters<ProductCommandRun>[0],
  hostToken: string,
): Promise<HostView | null> {
  const workspaceId = workspaceIdOf(context);
  const host = await resolveTarget(context, hostToken, ["node", "search"]);
  const definitions = await context.session.readProjection(
    workspaceId,
    context.perspective,
    "sharedDefaultViewDefinitions",
  );
  const current = (definitions[host.nodeId] ?? []).at(0);
  return current === undefined
    ? null
    : {
        hostNodeId: host.nodeId,
        hostLabel: host.label,
        viewId: current.viewId,
        viewDefinitionNodeId: current.viewDefinitionNodeId,
        options: current.options,
      };
}

export async function writeViewActions(
  context: Parameters<ProductCommandRun>[0],
  hostToken: string,
  action: string,
  build: (current: HostView) => readonly EditAction[],
) {
  const host = await resolveTarget(context, hostToken, ["node", "search"]);
  const existing = await readHostView(context, hostToken);
  if (existing === null) {
    throw new CliError("unsupported", `Node ${host.descriptor.ref} has no shared default View.`);
  }
  const { result, data } = await executeWrite(context, action, build(existing));
  const view = resource(context, "view", existing.viewDefinitionNodeId, `${host.label} view`);
  return writeResult(data, result, {
    extra: { target: view, on: host.descriptor },
    view: writeView("Updated view", view, `on ${host.label}`),
  });
}
