export type EngineHostState = Readonly<{
  phase: 'locked' | 'ready' | 'starting';
  vaultExists: boolean;
  actors: readonly Readonly<{
    actorId: string;
    label: string;
    unlocked: boolean;
  }>[];
  workspaces: readonly Readonly<{ workspaceId: string; label: string }>[];
}>;

export type ShellCommand = Readonly<{
  type: 'engine-command';
  id: string;
  command: Readonly<{
    kind: 'open-local';
    passphrase: string;
    actorLabel: string;
    workspaceLabel: string;
  }>;
}>;

export type NativeStorageOperation =
  | Readonly<{ method: 'identity-read'; kind: 'peer' | 'vault' }>
  | Readonly<{
      method: 'identity-write';
      kind: 'peer' | 'vault';
      bytes: readonly number[];
    }>
  | Readonly<{ method: 'workspace-list' }>
  | Readonly<{
      method: 'workspace-open' | 'workspace-stage';
      workspaceId: string;
    }>
  | Readonly<{
      method: 'workspace-promote' | 'workspace-delete';
      storageId: string;
    }>
  | Readonly<{ method: 'workspace-discard-staged' }>
  | Readonly<{ method: 'document-load'; storageId: string; documentId: string }>
  | Readonly<{
      method: 'document-append';
      storageId: string;
      updates: readonly Readonly<{ id: string; bytes: readonly number[] }>[];
    }>
  | Readonly<{
      method: 'document-snapshot';
      storageId: string;
      documentId: string;
      bytes: readonly number[];
    }>;

export type NativeStorageRequest = Readonly<{
  type: 'native-storage-request';
  id: string;
  operation: NativeStorageOperation;
}>;

export type NativeStorageResponse = Readonly<{
  type: 'native-storage-response';
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}>;

export type HostMessage =
  | Readonly<{ type: 'engine-state'; state: EngineHostState }>
  | Readonly<{ type: 'engine-error'; message: string }>
  | Readonly<{
      type: 'engine-command-response';
      id: string;
      ok: boolean;
      state?: EngineHostState;
      error?: string;
    }>
  | NativeStorageRequest;
