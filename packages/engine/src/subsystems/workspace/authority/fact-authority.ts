import type {
  Admission,
  AuthorityReceipt,
  FactSnapshot,
  InvocationId,
  ReplicaId,
  WorkspaceId,
} from "../../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/index.js";
import type { SyncBytes, SyncableDoc } from "../replica-sync.js";
import { SerialExecutor } from "../serial-executor.js";
import { planAuthorityCommit } from "./authority-commit-plan.js";
import { AuthorityJournalSession } from "./authority-journal-session.js";
import { importAuthorityUpdate } from "./authority-sync-import.js";
import type {
  AuthorityAdmissionPolicy,
  AuthorityCommit,
  AuthorityCommitResult,
  FactAuthorityPort,
} from "./authority-contract.js";
import { LoroFactReplica } from "./loro-fact-replica.js";
import { validateReplicaId } from "./replica-identity.js";

export { createReplicaId } from "./replica-identity.js";

export type FactAuthorityOptions = Readonly<{
  workspaceId: WorkspaceId;
  replicaId: ReplicaId;
  loroPeerId: `${number}`;
  authorityJournal: DocumentStore;
  factReplication: DocumentStore;
  snapshotInterval?: number;
  admitRecords: AuthorityAdmissionPolicy;
  /**
   * Actor attribution signer: returns the base64 Ed25519 signature over a
   * Fact's contentDigest for the body's actorId. Absent — or an unlocked-key
   * miss inside it — leaves attribution null, which governed journals reject.
   */
  signFact?: (digest: string, actorId: string) => string;
}>;

export class FactAuthority implements FactAuthorityPort {
  readonly replication: SyncableDoc;
  private readonly serial = new SerialExecutor();

  private constructor(
    private readonly options: FactAuthorityOptions,
    private readonly journal: AuthorityJournalSession,
    private readonly replica: LoroFactReplica,
    readonly replicaId: ReplicaId,
  ) {
    this.replication = replica.connect(
      (bytes) => this.importUpdate(bytes),
      () => this.serial.run(() => this.replica.heal(this.admission())),
    );
  }

  static async open(options: FactAuthorityOptions): Promise<FactAuthority> {
    validateReplicaId(options.replicaId);
    const journal = await AuthorityJournalSession.open({ ...options, documents: options.authorityJournal });
    const replica = await LoroFactReplica.open(
      {
        workspaceId: options.workspaceId,
        loroPeerId: options.loroPeerId,
        documents: options.factReplication,
        admitRecords: options.admitRecords,
      },
      journal.records(),
      journal.validRecords(),
    );
    return new FactAuthority(options, journal, replica, options.replicaId);
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

  historyImpacts(nodeId: string) {
    return this.journal.historyImpacts(nodeId);
  }

  recoverToLastValidPrefix = (): Promise<FactSnapshot> => this.serial.run(() => this.recoverExclusive());

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
      return { receipt: plan.receipt, created: false };
    }
    await this.journal.append(plan.records, plan.admission);
    return { receipt: plan.receipt, created: true };
  }

  private async importUpdate(bytes: SyncBytes): Promise<void> {
    return this.serial.run(async () => {
      await this.replica.heal(this.admission());
      await importAuthorityUpdate(bytes, {
        admission: this.admission(),
        records: this.journal.records(),
        replica: this.replica,
        append: (records) => this.journal.append(records),
      });
    });
  }

  private async recoverExclusive(): Promise<FactSnapshot> {
    if (this.admission().kind !== "fault") {
      return this.snapshot();
    }
    const snapshot = await this.journal.recover();
    await this.replica.rebuild(this.journal.records(), this.journal.validRecords());
    return snapshot;
  }
}
