export type LoadedDocumentBytes = {
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
};

export type DocumentUpdate = Readonly<{
  id: string;
  bytes: Uint8Array;
}>;

export type DocumentStore = {
  load(id: string): Promise<LoadedDocumentBytes | null>;
  appendUpdate(id: string, bytes: Uint8Array): Promise<number>;
  /** Appends every update atomically, returning its sequence in input order. */
  appendUpdates(updates: readonly DocumentUpdate[]): Promise<readonly number[]>;
  writeSnapshot(id: string, bytes: Uint8Array): Promise<void>;
};
