import type {
  EngineHostState,
  HostMessage,
  NativeStorageOperation,
  NativeStorageRequest,
} from './engine-worker/protocol.js';

export function parseHostMessage(value: unknown): HostMessage {
  const candidate = recordValue(value, 'Engine Worker message');
  if (candidate.type === 'native-storage-request') {
    return parseNativeStorageRequest(candidate);
  }
  if (candidate.type === 'engine-state') {
    return {
      type: 'engine-state',
      state: parseEngineHostState(candidate.state),
    };
  }
  if (candidate.type === 'engine-error') {
    return {
      type: 'engine-error',
      message: stringValue(candidate.message, 'Engine error'),
    };
  }
  if (candidate.type === 'engine-command-response') {
    const state =
      candidate.state === undefined
        ? undefined
        : parseEngineHostState(candidate.state);
    const error =
      candidate.error === undefined
        ? undefined
        : stringValue(candidate.error, 'Engine command error');
    return {
      type: 'engine-command-response',
      id: stringValue(candidate.id, 'Engine command id'),
      ok: booleanValue(candidate.ok, 'Engine command result'),
      ...(state === undefined ? {} : { state }),
      ...(error === undefined ? {} : { error }),
    };
  }
  throw new Error('Engine Worker sent an unsupported message');
}

export function describeError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

function parseNativeStorageRequest(
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

function parseEngineHostState(value: unknown): EngineHostState {
  const state = recordValue(value, 'Engine Worker state');
  const phase = state.phase;
  if (phase !== 'starting' && phase !== 'locked' && phase !== 'ready') {
    throw new Error('Engine Worker sent an invalid phase');
  }
  if (!Array.isArray(state.actors) || !Array.isArray(state.workspaces)) {
    throw new Error('Engine Worker sent invalid collections');
  }
  return {
    phase,
    vaultExists: booleanValue(state.vaultExists, 'Vault state'),
    actors: state.actors.map(actorValue),
    workspaces: state.workspaces.map(workspaceValue),
  };
}

function actorValue(value: unknown): EngineHostState['actors'][number] {
  const actor = recordValue(value, 'Actor');
  return {
    actorId: stringValue(actor.actorId, 'Actor id'),
    label: stringValue(actor.label, 'Actor label'),
    unlocked: booleanValue(actor.unlocked, 'Actor lock state'),
  };
}

function workspaceValue(value: unknown): EngineHostState['workspaces'][number] {
  const workspace = recordValue(value, 'Workspace');
  return {
    workspaceId: stringValue(workspace.workspaceId, 'Workspace id'),
    label: stringValue(workspace.label, 'Workspace label'),
  };
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

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
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
