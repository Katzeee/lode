export type LoadedDocumentBytes = {
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
};

export type DocumentStore = {
  load(id: string): Promise<LoadedDocumentBytes | null>;
  listIds(
    query?: Readonly<{
      prefix?: string;
      after?: string;
      limit?: number;
    }>,
  ): Promise<string[]>;
  appendUpdate(id: string, bytes: Uint8Array): Promise<number>;
  writeSnapshot(id: string, bytes: Uint8Array): Promise<void>;
  delete(id: string): Promise<void>;
};
