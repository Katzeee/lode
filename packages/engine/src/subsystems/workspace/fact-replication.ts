import type { SyncableComposite, SyncableDoc } from "./replica-sync.js";

export class FactReplication implements SyncableComposite {
  constructor(
    private readonly facts: SyncableDoc,
    private readonly reconcile: () => Promise<void> = () => Promise.resolve(),
  ) {}

  docs(): SyncableDoc[] {
    return [this.facts];
  }

  heal(): Promise<void> {
    return this.reconcile();
  }
}
