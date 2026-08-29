import { join } from "node:path";

import { readConfigurationStore, stringMapStore, writeConfigurationStore } from "./store-file.js";

const FIELD = "workspaceActors";

export async function readWorkspaceActor(homePath: string, workspaceId: string): Promise<string | null> {
  return (await readWorkspaceActors(homePath))?.[workspaceId] ?? null;
}

export async function setWorkspaceActor(homePath: string, workspaceId: string, actorId: string): Promise<void> {
  const workspaceActors = (await readWorkspaceActors(homePath)) ?? {};
  await writeConfigurationStore(workspaceActorsFile(homePath), {
    [FIELD]: { ...workspaceActors, [workspaceId]: actorId },
  });
}

function readWorkspaceActors(homePath: string): Promise<Readonly<Record<string, string>> | null> {
  return readConfigurationStore(workspaceActorsFile(homePath), "workspace-actors.json", (value) =>
    stringMapStore(value, FIELD, "Workspace Actor store"),
  );
}

function workspaceActorsFile(homePath: string): string {
  return join(homePath, "workspace-actors.json");
}
