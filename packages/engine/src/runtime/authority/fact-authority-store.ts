import type {
  Admission,
  AuthorityReceipt,
  FactFrontier,
  FactSnapshot,
  InvocationId,
  ReplicaId,
  WorkspaceId,
} from "../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import type { SyncBytes, SyncableDoc } from "../../sync/syncable.js";
import { SerialExecutor } from "../kernel/serial-executor.js";
import { planAuthorityCommit } from "./authority-commit-plan.js";
import { AuthorityJournalSession } from "./authority-journal-session.js";
import { importAuthorityUpdate } from "./authority-sync-import.js";
import type {
  AuthorityAdmissionPolicy,
  AuthorityCommit,
  AuthorityCommitResult,
  FactAuthority,
} from "./fact-authority.js";
import { AuthorityCommitUnknownError } from "./errors.js";
import { LoroFactReplica } from "./loro-fact-replica.js";
import { validateReplicaId } from "./replica-identity.js";
import { sortedInvocationIds } from "./authority-store-queries.js";

export { createReplicaId } from "./replica-identity.js";

export type FactAuthorityStoreOptions = Readonly<{
  workspaceId: WorkspaceId;
  replicaId: ReplicaId;
  loroPeerId: `${number}`;
  documents: DocumentStore;
  onAuthorityAdvanced?: (frontier: FactFrontier) => void;
  snapshotInterval?: number;
  admitRecords: AuthorityAdmissionPolicy;
  /**
   * Actor attribution signer: returns the base64 Ed25519 signature over a
   * Fact's contentDigest for the body's actorId. Absent — or an unlocked-key
   * miss inside it — leaves attribution null, which governed journals reject.
   */
  signFact?: (digest: string, actorId: string) => string;
}>;

export class FactAuthorityStore implements FactAuthority {
  readonly replication: SyncableDoc;
  private readonly serial = new SerialExecutor();
  private readonly uncertain = new Set<InvocationId>();

  private constructor(
    private readonly options: FactAuthorityStoreOptions,
    private readonly journal: AuthorityJournalSession,
    private readonly replica: LoroFactReplica,
    readonly replicaId: ReplicaId,
  ) {
    this.replication = replica.connect(
      (bytes) => this.importUpdate(bytes),
      () => this.serial.run(() => this.replica.heal(this.admission())),
    );
  }

  static async open(options: FactAuthorityStoreOptions): Promise<FactAuthorityStore> {
    validateReplicaId(options.replicaId);
    const journal = await AuthorityJournalSession.open(options);
    const replica = await LoroFactReplica.open(
      {
        workspaceId: options.workspaceId,
        loroPeerId: options.loroPeerId,
        documents: options.documents,
        admitRecords: options.admitRecords,
      },
      journal.records(),
      journal.validRecords(),
    );
    return new FactAuthorityStore(options, journal, replica, options.replicaId);
  }

  admission = (): Admission => this.journal.admission();

  snapshot = (): FactSnapshot => this.journal.snapshot();

  receipt = (invocationId: InvocationId): AuthorityReceipt | null => this.journal.receipt(invocationId);

  receipts = (): readonly AuthorityReceipt[] => this.journal.receipts();

  receiptsForChannel(channelId: string): readonly AuthorityReceipt[] {
    return this.journal.receiptsForChannel(channelId);
  }

  facts(factIds: readonly string[]) {
    return this.journal.facts(factIds);
  }

  relatedFacts(factIds: readonly string[]) {
    return this.journal.relatedFacts(factIds);
  }

  occurrenceNodeId(occurrenceId: string): string | null {
    return this.journal.occurrenceNodeId(occurrenceId);
  }

  historyImpacts(nodeId: string) {
    return this.journal.historyImpacts(nodeId);
  }

  uncertainInvocations = (): readonly InvocationId[] => sortedInvocationIds(this.uncertain);

  settleInvocation = (invocationId: InvocationId): void => void this.uncertain.delete(invocationId);

  recoverToLastValidPrefix = (): Promise<FactSnapshot> => this.serial.run(() => this.recoverExclusive());

  compact = (): Promise<void> => this.serial.run(() => this.journal.compact());

  commit = (input: AuthorityCommit): Promise<AuthorityCommitResult> =>
    this.serial.run(() => this.commitExclusive(input));

  private async commitExclusive(input: AuthorityCommit): Promise<AuthorityCommitResult> {
    const plan = planAuthorityCommit(input, {
      workspaceId: this.options.workspaceId,
      replicaId: this.replicaId,
      admission: this.admission(),
      records: this.journal.records(),
      existingReceipt: this.receipt(input.invocationId),
      maximumLamport: this.journal.maximumLamport(),
      previousChannelReceipt: input.lineage ? this.journal.lastReceiptForChannel(input.lineage.channelId) : null,
      admitRecords: this.options.admitRecords,
      signFact: this.options.signFact,
    });
    if (plan.kind === "replay") {
      await this.replica.heal(this.admission());
      this.uncertain.delete(input.invocationId);
      return { receipt: plan.receipt, created: false };
    }
    try {
      await this.journal.append(plan.records, plan.admission, false);
    } catch (error) {
      await this.adoptDurableAuthorityAfterUnknown();
      this.uncertain.add(input.invocationId);
      throw new AuthorityCommitUnknownError(input.invocationId, { cause: error });
    }
    try {
      await this.replica.publish(plan.facts);
      await this.journal.compactIfNeeded();
    } catch (error) {
      this.uncertain.add(input.invocationId);
      throw new AuthorityCommitUnknownError(input.invocationId, { cause: error });
    }
    return { receipt: plan.receipt, created: true };
  }

  private async importUpdate(bytes: SyncBytes): Promise<void> {
    return this.serial.run(() =>
      importAuthorityUpdate(bytes, {
        admission: this.admission(),
        records: this.journal.records(),
        replica: this.replica,
        append: (records) => this.journal.append(records),
      }),
    );
  }

  private async recoverExclusive(): Promise<FactSnapshot> {
    if (this.admission().kind !== "fault") {
      return this.snapshot();
    }
    const snapshot = await this.journal.recover();
    await this.replica.rebuild(this.journal.records(), this.journal.validRecords());
    return snapshot;
  }

  private async adoptDurableAuthorityAfterUnknown(): Promise<void> {
    try {
      await this.journal.reloadDurable(async (admission) => {
        if (admission.kind === "ready") {
          await this.replica.publish(admission.snapshot.facts);
        }
      });
    } catch {
      // The caller retains outcome-unknown when durable authority cannot be audited.
    }
  }
}
