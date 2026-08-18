import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  SYSTEM_DEFINITION_CATALOG_NODE_ID,
  canonicalDigest,
  canonicalJson,
  workspaceGenesisMutations,
  workspaceSchemaNodeId,
  workspaceTrashNodeId,
  type Fact,
  type FactSnapshot,
} from "../../domain/fact/index.js";
import { CURRENT_PROJECTION_VERSIONS, rebuildGeneration, textAtoms } from "../../domain/reconcile/index.js";
import { FactSyncComposite } from "../../runtime/sync/fact-sync.js";
import { openProposalWorkspace } from "../workspace/proposal-storage.js";

/**
 * Staging adoption: a Workspace replica arrives from a remote journal before
 * the Workspace becomes visible locally. The staging store lives under a
 * temporary file name; promotion is a rename plus a catalog record guarded by
 * an adoption manifest, so a crash anywhere leaves either a complete
 * Workspace or no trace — never a queryable half-adoption.
 */

export type OpenedStaging = Readonly<{
  facts: Awaited<ReturnType<typeof openProposalWorkspace>>["facts"];
  sync: FactSyncComposite;
}>;

export type StagedAdoption = Readonly<{
  workspaceId: string;
  stagingFile: string | undefined;
  /** Opens (once) the staging authority; imports land here until promotion. */
  open(): Promise<OpenedStaging>;
  /** Closes the staging store and moves it to the final storage path. */
  promote(): Promise<void>;
  /** Closes and deletes the staging store. */
  discard(): Promise<void>;
  /** Closes the store while leaving every file behind, exactly as a process
   * crash between pull and promotion would. Boot recovery cleans it up. */
  abandon(): Promise<void>;
}>;

export function workspaceStorageFile(dataRoot: string, workspaceId: string): string {
  return join(dataRoot, "workspaces", `${canonicalDigest(workspaceId)}.sqlite`);
}

export function stagingAdoptionFile(dataRoot: string | undefined, workspaceId: string): string | undefined {
  return dataRoot === undefined
    ? undefined
    : join(dataRoot, "workspaces", `.staging-${canonicalDigest(workspaceId)}-${randomUUID()}.sqlite`);
}

export function adoptionManifestFile(dataRoot: string | undefined, workspaceId: string): string {
  return join(dataRoot ?? ".", "adoption-manifests", `${canonicalDigest(workspaceId)}.json`);
}

/** Verifies that an admitted journal is a usable Workspace before it becomes visible. */
export function validateAdoptionSnapshot(workspaceId: string, snapshot: FactSnapshot): Readonly<{ label: string }> {
  const establish = snapshot.facts.filter(
    (fact) => fact.body.kind === "governance" && fact.body.action.kind === "workspace-establish",
  );
  if (establish.length !== 1) {
    throw new Error("Adopted journal must contain exactly one Workspace establishment");
  }
  const establishment = establish[0];
  if (
    establishment?.body.kind !== "governance" ||
    establishment.body.action.kind !== "workspace-establish" ||
    establishment.body.actorId !== establishment.body.action.ownerActorId
  ) {
    throw new Error("Workspace establishment must be signed by its initial owner");
  }
  const initialOwnerActorId = establishment.body.action.ownerActorId;

  const expectedGenesis = canonicalJson(workspaceGenesisMutations(workspaceId));
  const genesisTransactions = [...transactions(snapshot.facts).values()].filter((facts) => {
    const ordered = [...facts].sort((left, right) => left.transaction.index - right.transaction.index);
    return (
      ordered.length === facts[0]?.transaction.size &&
      ordered.every((fact) => fact.body.kind === "contribution") &&
      canonicalJson(ordered.map((fact) => (fact.body.kind === "contribution" ? fact.body.mutation : null))) ===
        expectedGenesis
    );
  });
  if (genesisTransactions.length !== 1) {
    throw new Error("Adopted journal must contain exactly one complete Workspace genesis transaction");
  }
  if (genesisTransactions[0]?.some((fact) => fact.body.actorId !== initialOwnerActorId)) {
    throw new Error("Workspace genesis must be attributed to its initial owner");
  }

  const projection = rebuildGeneration(workspaceId, snapshot, CURRENT_PROJECTION_VERSIONS).generation.origin;
  const root = projection.nodes[workspaceId];
  const system = projection.workspaceSystemNodes;
  if (
    root === undefined ||
    system.schema !== workspaceSchemaNodeId(workspaceId) ||
    system.trash !== workspaceTrashNodeId(workspaceId) ||
    system.systemDefinitionCatalog !== SYSTEM_DEFINITION_CATALOG_NODE_ID
  ) {
    throw new Error("Adopted journal does not project a complete Workspace root and system structure");
  }
  const label = textAtoms(root)
    .map((atom) => atom.value)
    .join("");
  if (label.trim().length === 0) {
    throw new Error("Adopted Workspace has no non-empty journal label");
  }
  return { label };
}

function transactions(facts: readonly Fact[]): ReadonlyMap<string, readonly Fact[]> {
  const grouped = new Map<string, Fact[]>();
  for (const fact of facts) {
    const transaction = grouped.get(fact.transaction.transactionId) ?? [];
    transaction.push(fact);
    grouped.set(fact.transaction.transactionId, transaction);
  }
  return grouped;
}

/** Opens an invisible staging replica for one adoption attempt. */
export function stageAdoption(
  options: Readonly<{ workspaceId: string; dataRoot: string | undefined }>,
): StagedAdoption {
  const stagingFile = stagingAdoptionFile(options.dataRoot, options.workspaceId);
  let opened: Awaited<ReturnType<typeof openProposalWorkspace>> | undefined;
  let closed = false;
  const close = async () => {
    if (opened !== undefined && !closed) {
      closed = true;
      await opened.close();
    }
  };
  return {
    workspaceId: options.workspaceId,
    stagingFile,
    open: async () => {
      if (closed) {
        throw new Error("The staging adoption is already finished");
      }
      opened ??= await openProposalWorkspace(options.workspaceId, options.dataRoot, { storageFile: stagingFile });
      return {
        facts: opened.facts,
        sync: new FactSyncComposite(opened.factReplica, () => opened!.workspace.reconcileAuthorityAdvance()),
      };
    },
    promote: async () => {
      await close();
      if (stagingFile === undefined || options.dataRoot === undefined) {
        return;
      }
      const finalFile = workspaceStorageFile(options.dataRoot, options.workspaceId);
      for (const suffix of ["-wal", "-shm"]) {
        await rm(`${finalFile}${suffix}`, { force: true }).catch(() => {});
      }
      await rename(stagingFile, finalFile);
      await rm(`${stagingFile}-wal`, { force: true }).catch(() => {});
      await rm(`${stagingFile}-shm`, { force: true }).catch(() => {});
    },
    discard: async () => {
      await close();
      if (stagingFile !== undefined) {
        for (const suffix of ["", "-wal", "-shm"]) {
          await rm(`${stagingFile}${suffix}`, { force: true }).catch(() => {});
        }
      }
    },
    abandon: close,
  };
}
