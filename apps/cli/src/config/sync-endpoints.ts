import { join } from "node:path";

import { readConfigurationStore, stringMapStore, writeConfigurationStore } from "./store-file.js";

const FIELD = "syncEndpoints";

export async function readSyncEndpoint(homePath: string, workspaceId: string): Promise<string | null> {
  return (await readSyncEndpoints(homePath))?.[workspaceId] ?? null;
}

export async function setSyncEndpoint(homePath: string, workspaceId: string, endpoint: string): Promise<void> {
  const syncEndpoints = (await readSyncEndpoints(homePath)) ?? {};
  await writeConfigurationStore(syncEndpointsFile(homePath), {
    [FIELD]: { ...syncEndpoints, [workspaceId]: endpoint },
  });
}

function readSyncEndpoints(homePath: string): Promise<Readonly<Record<string, string>> | null> {
  return readConfigurationStore(syncEndpointsFile(homePath), "sync-endpoints.json", (value) =>
    stringMapStore(value, FIELD, "Sync endpoint store"),
  );
}

function syncEndpointsFile(homePath: string): string {
  return join(homePath, "sync-endpoints.json");
}
