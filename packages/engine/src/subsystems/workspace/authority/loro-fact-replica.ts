import type { LoroDoc } from "loro-crdt";

import type { Admission, AuthorityRecord } from "../../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/index.js";
import type { SyncBytes, SyncableDoc } from "../replica-sync.js";
import type { AuthorityAdmissionPolicy } from "./authority-contract.js";
import { createFactSyncDoc } from "./fact-sync-projection.js";
import { healFactSyncProjection, loadSyncProjection, persistSyncProjection } from "./loro-fact-replica-state.js";
import { validateStagedSyncImport } from "./sync-import-validation.js";

export const FACT_REPLICATION_DOCUMENT_ID = "facts";

export type PreparedFactImport =
  | Readonly<{ kind: "fault"; reason: string; records: readonly AuthorityRecord[] }>
  | Readonly<{
      kind: "ready";
      records: readonly AuthorityRecord[];
      accept(): Promise<void>;
    }>;

export class LoroFactReplica {
  private constructor(
    private readonly options: Readonly<{
      workspaceId: string;
      loroPeerId: `${number}`;
      documents: DocumentStore;
      admitRecords: AuthorityAdmissionPolicy;
    }>,
    private projection: LoroDoc,
  ) {}

  static async open(
    options: Readonly<{
      workspaceId: string;
      loroPeerId: `${number}`;
      documents: DocumentStore;
      admitRecords: AuthorityAdmissionPolicy;
    }>,
    authorityRecords: readonly unknown[],
    validAuthorityRecords: readonly AuthorityRecord[],
  ): Promise<LoroFactReplica> {
    const projection = await loadSyncProjection(options, authorityRecords, validAuthorityRecords);
    return new LoroFactReplica(options, projection);
  }

  connect(importUpdate: (bytes: SyncBytes) => Promise<void>, heal: () => Promise<void>): SyncableDoc {
    return createFactSyncDoc(FACT_REPLICATION_DOCUMENT_ID, () => this.projection, importUpdate, heal);
  }

  prepareImport(bytes: SyncBytes, authorityRecords: readonly unknown[]): PreparedFactImport {
    const staged = this.projection.fork();
    staged.setPeerId(this.options.loroPeerId);
    staged.import(bytes);
    const validation = validateStagedSyncImport(
      this.options.workspaceId,
      authorityRecords,
      staged,
      this.options.admitRecords,
    );
    if (validation.kind === "fault") {
      return validation;
    }
    return {
      kind: "ready",
      records: validation.records,
      accept: async () => {
        this.projection = staged;
        await persistSyncProjection(this.options.documents, this.projection);
      },
    };
  }

  heal(admission: Admission): Promise<void> {
    return healFactSyncProjection(this.options.documents, this.projection, admission);
  }

  async rebuild(
    authorityRecords: readonly unknown[],
    validAuthorityRecords: readonly AuthorityRecord[],
  ): Promise<void> {
    this.projection = await loadSyncProjection(this.options, authorityRecords, validAuthorityRecords);
  }
}
