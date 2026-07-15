import { randomUUID } from "node:crypto";
import { atomicWrite, readTextMaybe, type LodeHomePaths } from "@lode/daemon/home";

// The socket-deployment identity a CLI process sends on every RPC: a stable client id (this install)
// + the active actor id (the selected identity). Both live in LODE_HOME; the daemon binds them per
// connection and `resolveCaller` resolves the vault keypair for the actor.

/** Read this install's stable client id, generating + persisting it on first run. */
export async function readOrCreateClientId(paths: LodeHomePaths): Promise<string> {
  const existing = await readTextMaybe(paths.clientId);
  if (existing !== undefined && existing.trim() !== "") {
    return existing.trim();
  }
  const id = randomUUID();
  await atomicWrite(paths.clientId, `${id}\n`);
  return id;
}

/** The currently active actor id (set by `actor use`/`actor new`), or undefined if none selected. */
export async function readActiveActor(paths: LodeHomePaths): Promise<string | undefined> {
  const raw = await readTextMaybe(paths.activeActor);
  const value = raw?.trim();
  return value === "" ? undefined : value;
}

/** Persist the active actor id (`actor use` / `actor new` / `actor import`). */
export async function writeActiveActor(paths: LodeHomePaths, actorId: string): Promise<void> {
  await atomicWrite(paths.activeActor, `${actorId}\n`);
}

/** Build the per-RPC identity headers. `actorOverride` (--actor) wins over the active actor file. */
export async function buildHeaders(
  paths: LodeHomePaths,
  actorOverride?: string,
): Promise<Record<string, string>> {
  const clientId = await readOrCreateClientId(paths);
  const actorId = actorOverride ?? (await readActiveActor(paths));
  const headers: Record<string, string> = { "lode-client-id": clientId };
  if (actorId !== undefined) {
    headers["lode-actor-id"] = actorId;
  }
  return headers;
}
