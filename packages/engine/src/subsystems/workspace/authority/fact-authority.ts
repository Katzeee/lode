import type {
  AuthorityReceipt,
  FactSnapshot,
  FactActionId,
  FactId,
  InvocationId,
  ReplicaId,
  WorkspaceId,
} from "../../../domain/fact/index.js";
import { frontierEquals, requestDigest, validatePlannedReceiptAppend } from "../../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/index.js";
import type { SyncBytes, SyncableDoc } from "./replication.js";
import { SerialExecutor } from "./serial-executor.js";
import type { AuthorityCommit, AuthorityCommitResult, FactAuthorityPort } from "./authority-contract.js";
import { LoroFactStore } from "./loro-fact-store.js";
import { LocalReceiptStore } from "./local-receipt-store.js";
import { FactValidationError, InvocationConflictError, ProjectionUnavailableError } from "./errors.js";

type FactAuthorityOptions = Readonly<{
  workspaceId: WorkspaceId;
  loroPeerId: `${number}`;
  documents: DocumentStore;
}>;

export class FactAuthority implements FactAuthorityPort {
  readonly replication: SyncableDoc;
  private readonly serial = new SerialExecutor();

  private constructor(
    private readonly options: FactAuthorityOptions,
    private readonly store: LoroFactStore,
    private readonly receiptStore: LocalReceiptStore,
    readonly replicaId: ReplicaId,
  ) {
    this.replication = {
      ...store.replication,
      importUpdate: (bytes) => this.importUpdate(bytes),
    };
  }

  static async open(options: FactAuthorityOptions): Promise<FactAuthority> {
    const store = await LoroFactStore.open({
      workspaceId: options.workspaceId,
      loroPeerId: options.loroPeerId,
      documents: options.documents,
    });
    const receiptStore = await LocalReceiptStore.open(
      { workspaceId: options.workspaceId, replicaId: options.loroPeerId, documents: options.documents },
      store.allFacts(),
    );
    return new FactAuthority(options, store, receiptStore, options.loroPeerId);
  }

  snapshot = (): FactSnapshot => this.store.snapshot();

  receipt = (invocationId: InvocationId): AuthorityReceipt | null => this.receiptStore.receipt(invocationId);

  receipts = (): readonly AuthorityReceipt[] => this.receiptStore.receipts();

  facts(factIds: readonly FactId[]) {
    return this.store.facts(factIds);
  }

  factsOwningActions(actionIds: readonly FactActionId[]) {
    return this.store.factsOwningActions(actionIds);
  }

  relatedFacts(factIds: readonly FactId[]) {
    return this.store.relatedFacts(factIds);
  }

  relatedFactsOwningActions(actionIds: readonly FactActionId[]) {
    return this.store.relatedFactsOwningActions(actionIds);
  }

  commit = (input: AuthorityCommit): Promise<AuthorityCommitResult> =>
    this.serial.run(() => this.commitExclusive(input));

  private async commitExclusive(input: AuthorityCommit): Promise<AuthorityCommitResult> {
    const digest = requestDigest(input.request);
    const existing = this.receipt(input.invocationId);
    if (existing) {
      if (existing.requestDigest !== digest) {
        throw new InvocationConflictError(`Invocation request conflict: ${input.invocationId}`);
      }
      return { receipt: existing, created: false };
    }
    if (input.writes.length === 0) {
      throw new FactValidationError("Authority commit requires at least one Fact write");
    }
    const current = this.snapshot();
    if (!frontierEquals(current.frontier, input.publishedFrontier)) {
      throw new ProjectionUnavailableError(
        "State-dependent command requires a complete generation at the authoritative frontier",
      );
    }

    const facts = this.store.stageAppend(input.writes);
    const expectedFactCount = input.writes.length;
    if (facts.facts.length !== expectedFactCount) {
      throw new FactValidationError("Local Fact append does not match the validated Fact set");
    }
    const committedFacts = facts.facts;
    const authorityReceipt: AuthorityReceipt = {
      workspaceId: this.options.workspaceId,
      replicaId: this.replicaId,
      invocationId: input.invocationId,
      requestDigest: digest,
      factIds: committedFacts.map((fact) => fact.id),
      committedFrontier: facts.snapshot.frontier,
      lineage: input.lineage,
    };
    validatePlannedReceiptAppend(this.options.workspaceId, authorityReceipt, committedFacts);
    const receipt = this.receiptStore.stageAppend(authorityReceipt);
    await this.options.documents.appendUpdates([facts.update, receipt.update]);
    facts.apply();
    receipt.apply();
    await Promise.all([facts.compact(), receipt.compact()]);
    return { receipt: authorityReceipt, created: true };
  }

  private async importUpdate(bytes: SyncBytes): Promise<void> {
    return this.serial.run(() => this.store.replication.importUpdate(bytes));
  }
}
