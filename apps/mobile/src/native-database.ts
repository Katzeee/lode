import { NativeModules } from 'react-native';

import type { NativeStorageOperation } from './engine-host-protocol';

type LodeDatabase = Readonly<{
  readIdentityBlob(kind: 'peer' | 'vault'): Promise<unknown>;
  writeIdentityBlob(
    kind: 'peer' | 'vault',
    bytes: readonly number[],
  ): Promise<unknown>;
  listWorkspaceIds(): Promise<unknown>;
  openWorkspace(workspaceId: string): Promise<unknown>;
  stageWorkspace(workspaceId: string): Promise<unknown>;
  promoteWorkspace(storageId: string): Promise<unknown>;
  deleteWorkspaceStorage(storageId: string): Promise<unknown>;
  discardStagedWorkspaces(): Promise<unknown>;
  loadDocument(storageId: string, documentId: string): Promise<unknown>;
  appendDocumentUpdates(
    storageId: string,
    updates: readonly Readonly<{ id: string; bytes: readonly number[] }>[],
  ): Promise<unknown>;
  writeDocumentSnapshot(
    storageId: string,
    documentId: string,
    bytes: readonly number[],
  ): Promise<unknown>;
}>;

export const database = NativeModules.LodeDatabase as LodeDatabase | undefined;

export async function executeStorageOperation(
  native: LodeDatabase,
  operation: NativeStorageOperation,
): Promise<unknown> {
  switch (operation.method) {
    case 'identity-read':
      return native.readIdentityBlob(operation.kind);
    case 'identity-write':
      return native.writeIdentityBlob(operation.kind, operation.bytes);
    case 'workspace-list':
      return native.listWorkspaceIds();
    case 'workspace-open':
      return native.openWorkspace(operation.workspaceId);
    case 'workspace-stage':
      return native.stageWorkspace(operation.workspaceId);
    case 'workspace-promote':
      return native.promoteWorkspace(operation.storageId);
    case 'workspace-delete':
      return native.deleteWorkspaceStorage(operation.storageId);
    case 'workspace-discard-staged':
      return native.discardStagedWorkspaces();
    case 'document-load':
      return native.loadDocument(operation.storageId, operation.documentId);
    case 'document-append':
      return native.appendDocumentUpdates(
        operation.storageId,
        operation.updates,
      );
    case 'document-snapshot':
      return native.writeDocumentSnapshot(
        operation.storageId,
        operation.documentId,
        operation.bytes,
      );
  }
}
