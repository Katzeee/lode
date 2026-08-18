import type { EngineApplicationContract, EngineCommand, WriteResult } from "@lode/sdk";

import { projectGovernance } from "../domain/governance/index.js";
import type { IdentityRuntime } from "./identity/identity-runtime.js";
import type { WorkspaceSessions } from "./workspace-sessions/index.js";

/**
 * The composition-level application contract: every write command on a
 * governed workspace must act as a member Actor with an unlocked key, or be
 * rejected before it reaches planning. Ungoverned journals (engine-internal
 * test contexts) carry no actor requirement.
 */

export function wrappedApplication(
  inner: EngineApplicationContract,
  context: Readonly<{ identity: IdentityRuntime; sessions: WorkspaceSessions }>,
): EngineApplicationContract {
  return {
    execute: async (command) => actorRejection(command, context) ?? (await inner.execute(command)),
    query: inner.query,
    subscribe: inner.subscribe,
  };
}

function actorRejection(
  command: EngineCommand,
  context: Readonly<{ identity: IdentityRuntime; sessions: WorkspaceSessions }>,
): WriteResult | null {
  const actorId = (command as Readonly<{ actorId?: unknown }>).actorId;
  if (typeof actorId !== "string") {
    return null;
  }
  const workspaceId = (command as Readonly<{ workspaceId?: unknown }>).workspaceId;
  if (typeof workspaceId !== "string" || !context.sessions.isCataloged(workspaceId)) {
    return null;
  }
  const admission = context.sessions.authority(workspaceId).admission();
  if (admission.kind === "fault") {
    return null;
  }
  const state = projectGovernance(admission.snapshot.facts);
  if (!state.established) {
    return null;
  }
  if (!state.members.has(actorId)) {
    return rejected("actor-not-member", `Actor ${actorId} is not a member of workspace ${workspaceId}`);
  }
  if (!context.identity.isActorUnlocked(actorId)) {
    return rejected(
      "actor-locked",
      `Actor ${actorId} has no unlocked key in this Home; unlock the vault before writing or governing`,
    );
  }
  return null;
}

function rejected(code: "actor-not-member" | "actor-locked", message: string): WriteResult {
  return { status: "rejected", error: { code, message, currentGenerationId: null } };
}
