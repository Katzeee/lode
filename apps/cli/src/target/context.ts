import type { CommandContext } from "../command/index.js";
import { workspaceIdOf } from "../intent/index.js";
import { resolveNodeTarget, resolveOccurrenceTarget } from "./nodes.js";
import { descriptor, type ResourceDescriptor, type TargetKind } from "./selector.js";

/** Target resolution bound to the command's workspace and perspective. */
type TargetContext = Pick<CommandContext, "session" | "workspace" | "perspective">;

export function resolveTarget(
  context: TargetContext,
  token: string,
  kinds: readonly TargetKind[],
  scope: Readonly<{ underParentIds?: readonly string[] }> = {},
): ReturnType<typeof resolveNodeTarget> {
  return resolveNodeTarget(context.session, workspaceIdOf(context), context.perspective, token, kinds, scope);
}

export function resolveOccurrence(
  context: TargetContext,
  token: string,
  options?: Readonly<{ nodeKinds: readonly TargetKind[]; fromParentIds?: readonly string[] }>,
): ReturnType<typeof resolveOccurrenceTarget> {
  return resolveOccurrenceTarget(context.session, workspaceIdOf(context), context.perspective, token, options);
}

export function resource(context: TargetContext, kind: TargetKind, id: string, label: string): ResourceDescriptor {
  return descriptor(workspaceIdOf(context), kind, id, label);
}
