import type { SyncableComposite, SyncableDoc } from "../../sync/syncable.js";

export class FactSyncComposite implements SyncableComposite {
  constructor(
    private readonly facts: SyncableDoc,
    private readonly reconcile: () => Promise<void> = () => Promise.resolve(),
  ) {}

  docs(): SyncableDoc[] {
    return [this.facts];
  }

  pushDocs(): SyncableDoc[] {
    return this.docs();
  }

  heal(): Promise<void> {
    return this.reconcile();
  }
}
