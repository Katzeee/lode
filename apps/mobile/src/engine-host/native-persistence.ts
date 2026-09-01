/// <reference lib="dom" />

import type {
  MobileDocumentUpdate,
  MobileLoadedDocument,
  MobilePersistenceBridge,
} from '@lode/engine-platform-mobile';

import type {
  NativeStorageOperation,
  NativeStorageResponse,
} from '../engine-host-protocol.js';

type EngineHostWindow = Window &
  Readonly<{
    ReactNativeWebView?: Readonly<{ postMessage(message: string): void }>;
  }>;

let sequence = 0;
const pending = new Map<
  string,
  Readonly<{ resolve(value: unknown): void; reject(error: Error): void }>
>();

export const nativePersistence: MobilePersistenceBridge = {
  readIdentityBlob: async kind =>
    nullableBytes(await request({ method: 'identity-read', kind })),
  writeIdentityBlob: (kind, bytes) =>
    requestVoid({ method: 'identity-write', kind, bytes: [...bytes] }),
  listWorkspaceIds: async () =>
    stringArray(await request({ method: 'workspace-list' })),
  openWorkspace: async workspaceId =>
    stringValue(await request({ method: 'workspace-open', workspaceId })),
  stageWorkspace: async workspaceId =>
    stringValue(await request({ method: 'workspace-stage', workspaceId })),
  promoteWorkspace: storageId =>
    requestVoid({ method: 'workspace-promote', storageId }),
  deleteWorkspaceStorage: storageId =>
    requestVoid({ method: 'workspace-delete', storageId }),
  discardStagedWorkspaces: () =>
    requestVoid({ method: 'workspace-discard-staged' }),
  loadDocument: async (storageId, id) =>
    loadedDocument(
      await request({ method: 'document-load', storageId, documentId: id }),
    ),
  appendDocumentUpdates: async (storageId, updates) =>
    numberArray(
      await request({
        method: 'document-append',
        storageId,
        updates: updates.map(toWireUpdate),
      }),
    ),
  writeDocumentSnapshot: (storageId, id, bytes) =>
    requestVoid({
      method: 'document-snapshot',
      storageId,
      documentId: id,
      bytes: [...bytes],
    }),
  close: () => {},
};

export function acceptNativeStorageResponse(value: unknown): boolean {
  if (!isNativeStorageResponse(value)) {
    return false;
  }
  const task = pending.get(value.id);
  if (task === undefined) {
    return true;
  }
  pending.delete(value.id);
  if (value.ok) {
    task.resolve(value.value);
  } else {
    task.reject(new Error(value.error ?? 'Native SQLite operation failed'));
  }
  return true;
}

function request(operation: NativeStorageOperation): Promise<unknown> {
  const id = `storage-${++sequence}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const bridge = (window as EngineHostWindow).ReactNativeWebView;
    if (bridge === undefined) {
      pending.delete(id);
      reject(new Error('React Native storage bridge is unavailable'));
      return;
    }
    bridge.postMessage(
      JSON.stringify({ type: 'native-storage-request', id, operation }),
    );
  });
}

async function requestVoid(operation: NativeStorageOperation): Promise<void> {
  await request(operation);
}

function toWireUpdate(update: MobileDocumentUpdate) {
  return { id: update.id, bytes: [...update.bytes] };
}

function loadedDocument(value: unknown): MobileLoadedDocument | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('Native SQLite returned an invalid document');
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.updates)) {
    throw new Error('Native SQLite returned invalid document updates');
  }
  return {
    snapshot: nullableBytes(candidate.snapshot),
    updates: candidate.updates.map(bytesValue),
  };
}

function nullableBytes(value: unknown): Uint8Array | null {
  return value === null ? null : bytesValue(value);
}

function bytesValue(value: unknown): Uint8Array {
  if (!Array.isArray(value) || !value.every(isByte)) {
    throw new Error('Native SQLite returned invalid bytes');
  }
  return new Uint8Array(value);
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Native SQLite returned an invalid string');
  }
  return value;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error('Native SQLite returned an invalid string list');
  }
  return value;
}

function numberArray(value: unknown): readonly number[] {
  if (!Array.isArray(value)) {
    throw new Error('Native SQLite returned an invalid sequence list');
  }
  return value.map(item => {
    if (typeof item !== 'number' || !Number.isSafeInteger(item)) {
      throw new Error('Native SQLite returned an invalid sequence list');
    }
    return item;
  });
}

function isByte(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    typeof value === 'number' &&
    value >= 0 &&
    value <= 255
  );
}

function isNativeStorageResponse(
  value: unknown,
): value is NativeStorageResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === 'native-storage-response' &&
    typeof candidate.id === 'string' &&
    typeof candidate.ok === 'boolean' &&
    (candidate.error === undefined || typeof candidate.error === 'string')
  );
}
