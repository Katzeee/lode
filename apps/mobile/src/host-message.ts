import type {
  NativeStorageOperation,
  NativeStorageRequest,
} from './engine-worker/protocol.js';
export function parseNativeStorageRequest(
  candidate: Readonly<Record<string, unknown>>,
): NativeStorageRequest {
  return {
    type: 'native-storage-request',
    id: stringValue(candidate.id, 'Native storage request id'),
    operation: parseNativeStorageOperation(candidate.operation),
  };
}

function parseNativeStorageOperation(value: unknown): NativeStorageOperation {
  const operation = recordValue(value, 'Native storage operation');
  const method = stringValue(operation.method, 'Native storage method');
  switch (method) {
    case 'identity-read':
      return { method, kind: identityKind(operation.kind) };
    case 'identity-write':
      return {
        method,
        kind: identityKind(operation.kind),
        bytes: bytesValue(operation.bytes),
      };
    case 'workspace-list':
    case 'workspace-discard-staged':
      return { method };
    case 'workspace-open':
    case 'workspace-stage':
      return {
        method,
        workspaceId: stringValue(operation.workspaceId, 'Workspace id'),
      };
    case 'workspace-promote':
    case 'workspace-delete':
      return {
        method,
        storageId: stringValue(operation.storageId, 'Workspace storage id'),
      };
    case 'document-load':
      return {
        method,
        storageId: stringValue(operation.storageId, 'Workspace storage id'),
        documentId: stringValue(operation.documentId, 'Document id'),
      };
    case 'document-append':
      return {
        method,
        storageId: stringValue(operation.storageId, 'Workspace storage id'),
        updates: documentUpdates(operation.updates),
      };
    case 'document-snapshot':
      return {
        method,
        storageId: stringValue(operation.storageId, 'Workspace storage id'),
        documentId: stringValue(operation.documentId, 'Document id'),
        bytes: bytesValue(operation.bytes),
      };
    default:
      throw new Error(
        `Engine Worker requested unsupported storage method ${method}`,
      );
  }
}

function documentUpdates(
  value: unknown,
): Extract<NativeStorageOperation, { method: 'document-append' }>['updates'] {
  if (!Array.isArray(value)) {
    throw new Error('Document updates must be an array');
  }
  return value.map(item => {
    const update = recordValue(item, 'Document update');
    return {
      id: stringValue(update.id, 'Document update id'),
      bytes: bytesValue(update.bytes),
    };
  });
}

function bytesValue(value: unknown): readonly number[] {
  if (!Array.isArray(value) || !value.every(isByte)) {
    throw new Error('Native storage bytes are invalid');
  }
  return value;
}

function identityKind(value: unknown): 'peer' | 'vault' {
  if (value !== 'peer' && value !== 'vault') {
    throw new Error('Identity blob kind is invalid');
  }
  return value;
}

function recordValue(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function isByte(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 255
  );
}
