export type MobileIdentityBlob = "peer" | "vault";

export type MobileDocumentUpdate = Readonly<{
  id: string;
  bytes: Uint8Array;
}>;

export type MobileLoadedDocument = Readonly<{
  snapshot: Uint8Array | null;
  updates: readonly Uint8Array[];
}>;

/**
 * The native storage operations required by the mobile Engine Host. The app owns SQLite and
 * transaction execution; the Engine owns persistence semantics and never sends arbitrary SQL.
 */
export type MobilePersistenceBridge = Readonly<{
  readIdentityBlob(kind: MobileIdentityBlob): Promise<Uint8Array | null>;
  writeIdentityBlob(kind: MobileIdentityBlob, bytes: Uint8Array): Promise<void>;
  listWorkspaceIds(): Promise<readonly string[]>;
  openWorkspace(workspaceId: string): Promise<string>;
  stageWorkspace(workspaceId: string): Promise<string>;
  promoteWorkspace(storageId: string): Promise<void>;
  deleteWorkspaceStorage(storageId: string): Promise<void>;
  discardStagedWorkspaces(): Promise<void>;
  loadDocument(storageId: string, id: string): Promise<MobileLoadedDocument | null>;
  appendDocumentUpdates(storageId: string, updates: readonly MobileDocumentUpdate[]): Promise<readonly number[]>;
  writeDocumentSnapshot(storageId: string, id: string, bytes: Uint8Array): Promise<void>;
  close(): void | Promise<void>;
}>;
