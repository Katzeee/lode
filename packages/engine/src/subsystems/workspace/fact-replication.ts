import type { SyncableDoc } from "./authority/replication.js";

export type SyncableComposite = Readonly<{
  docs(): SyncableDoc[];
  heal(): Promise<void>;
}>;

export class FactReplication implements SyncableComposite {
  constructor(
    private readonly facts: SyncableDoc,
    private readonly reconcile: () => Promise<void>,
  ) {}

  docs(): SyncableDoc[] {
    return [this.facts];
  }

  heal(): Promise<void> {
    return this.reconcile();
  }
}
