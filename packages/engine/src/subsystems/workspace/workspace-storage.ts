import { randomBytes } from "node:crypto";
import type { WorkspaceStorage } from "../persistence/index.js";
import type { EventSink } from "../event/index.js";
import { FactAuthority } from "./authority/fact-authority.js";
import { Workspace } from "./workspace.js";
import { CURRENT_PROJECTION_VERSIONS } from "../../domain/reconcile/index.js";

const LOCAL_REPLICA_DOCUMENT_ID = "local-replica";

type LocalReplica = Readonly<{
  loroPeerId: `${number}`;
}>;

export async function createWorkspaceFromStorage(
  storage: WorkspaceStorage,
  options: Readonly<{
    eventSink: EventSink;
  }>,
) {
  try {
    const local = await loadOrCreateLocalReplica(storage.metadata);
    const facts = await FactAuthority.open({
      workspaceId: storage.workspaceId,
      loroPeerId: local.loroPeerId,
      documents: storage.facts,
    });
    const workspace = Workspace.open({
      workspaceId: storage.workspaceId,
      facts,
      versions: CURRENT_PROJECTION_VERSIONS,
      eventSink: options.eventSink,
      storage,
    });
    return workspace;
  } catch (error) {
    return failAfterRelease(error, storage.release);
  }
}

async function failAfterRelease(primary: unknown, release: () => Promise<void>): Promise<never> {
  try {
    await release();
  } catch (releaseError) {
    const failure = new AggregateError([toError(primary), toError(releaseError)], "Workspace failed to open cleanly", {
      cause: primary,
    });
    throw failure;
  }
  throw primary;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function loadOrCreateLocalReplica(documents: WorkspaceStorage["metadata"]): Promise<LocalReplica> {
  const loaded = await documents.load(LOCAL_REPLICA_DOCUMENT_ID);
  if (loaded?.snapshot) {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(loaded.snapshot));
    if (isLocalReplica(parsed)) {
      return parsed;
    }
    throw new Error("Local Replica identity is corrupt");
  }
  const local = {
    loroPeerId: createLoroPeerId(),
  } as const;
  await documents.writeSnapshot(LOCAL_REPLICA_DOCUMENT_ID, new TextEncoder().encode(JSON.stringify(local)));
  return local;
}

function createLoroPeerId(): `${number}` {
  let value = 0n;
  while (value === 0n) {
    value = randomBytes(8).readBigUInt64BE();
  }
  return `${value}` as `${number}`;
}

function isLocalReplica(value: unknown): value is LocalReplica {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 1 &&
    typeof candidate.loroPeerId === "string" &&
    /^\d+$/.test(candidate.loroPeerId)
  );
}
