import type { SyncableComposite, SyncableDoc } from "../../sync/syncable.js";
import type { FactStore } from "../authority/fact-store.js";

export class FactSyncComposite implements SyncableComposite {
  constructor(
    private readonly facts: FactStore,
    private readonly reconcile: () => Promise<void> = () => Promise.resolve(),
  ) {}

  docs(): SyncableDoc[] {
    return [this.facts.syncDoc];
  }

  pushDocs(): SyncableDoc[] {
    return this.docs();
  }

  heal(): Promise<void> {
    return this.reconcile();
  }
}
