export type SyncBytes = Uint8Array;

export type SyncableDoc = Readonly<{
  id: string;
  version(): Promise<SyncBytes>;
  exportUpdate(from?: SyncBytes): Promise<SyncBytes>;
  importUpdate(bytes: SyncBytes): Promise<void>;
}>;
