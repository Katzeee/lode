export type SyncBytes = Uint8Array;

export type SyncableDoc = Readonly<{
  id: string;
  version(): Promise<SyncBytes>;
  exportUpdate(from?: SyncBytes): Promise<SyncBytes>;
  exportSnapshot(): Promise<SyncBytes>;
  importUpdate(bytes: SyncBytes): Promise<void>;
}>;

export type SyncableComposite = Readonly<{
  docs(): SyncableDoc[];
  pushDocs(): SyncableDoc[];
  heal(): Promise<void>;
  revisions?(): Map<string, number>;
}>;
