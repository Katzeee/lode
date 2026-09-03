import type { Engine, PeerTransportPort } from '@lode/engine';
import { createMobileEngine } from '@lode/engine-platform-mobile';

import type { EngineHostState, HostMessage, ShellCommand } from './protocol.js';
import {
  acceptNativeStorageResponse,
  nativePersistence,
} from './native-persistence.js';

type WorkerScope = Readonly<{
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  addEventListener(
    type: 'unhandledrejection',
    listener: (event: PromiseRejectionEvent) => void,
  ): void;
  postMessage(message: HostMessage): void;
}>;

const workerScope = globalThis as unknown as WorkerScope;
const localOnlyPeerTransport: PeerTransportPort = {
  start: () => {},
  dial: endpoint => {
    throw new Error(`Mobile Peer Transport is not configured for ${endpoint}`);
  },
  close: () => {},
};

let engine: Engine | undefined;

function publish(message: HostMessage): void {
  workerScope.postMessage(message);
}

async function stateOf(
  phase?: EngineHostState['phase'],
): Promise<EngineHostState> {
  const active = requiredEngine();
  const identity = await active.api.identity.listActors();
  return {
    phase:
      phase ??
      (identity.actors.some(actor => actor.unlocked) ? 'ready' : 'locked'),
    vaultExists: identity.vaultExists,
    actors: identity.actors,
    workspaces: await active.api.workspaces.listWorkspaces(),
  };
}

async function start(): Promise<void> {
  publish({
    type: 'engine-state',
    state: {
      phase: 'starting',
      vaultExists: false,
      actors: [],
      workspaces: [],
    },
  });
  const created = createMobileEngine({
    persistence: nativePersistence,
    peerTransport: localOnlyPeerTransport,
  });
  try {
    await created.start();
    engine = created;
    publish({ type: 'engine-state', state: await stateOf() });
  } catch (error) {
    await created.stop().catch(() => {});
    publish({ type: 'engine-error', message: describeError(error) });
  }
}

async function openLocal(command: ShellCommand): Promise<EngineHostState> {
  const active = requiredEngine();
  const before = await active.api.identity.listActors();
  await (before.vaultExists
    ? active.api.identity.unlockVault(command.command.passphrase)
    : active.api.identity.createActor({
        label: command.command.actorLabel,
        passphrase: command.command.passphrase,
      }));
  const identity = await active.api.identity.listActors();
  const workspaces = await active.api.workspaces.listWorkspaces();
  if (workspaces.length === 0) {
    const ownerActorId = identity.actors.find(actor => actor.unlocked)?.actorId;
    if (ownerActorId === undefined) {
      throw new Error(
        'The mobile Engine has no unlocked Actor for Workspace creation',
      );
    }
    await active.api.workspaces.createWorkspace({
      workspaceId: `mobile-${randomUuid()}`,
      label: command.command.workspaceLabel,
      ownerActorId,
    });
  }
  return stateOf('ready');
}

async function handleShellCommand(command: ShellCommand): Promise<void> {
  try {
    const state = await openLocal(command);
    publish({
      type: 'engine-command-response',
      id: command.id,
      ok: true,
      state,
    });
    publish({ type: 'engine-state', state });
  } catch (error) {
    publish({
      type: 'engine-command-response',
      id: command.id,
      ok: false,
      error: describeError(error),
    });
  }
}

function receive(message: MessageEvent<unknown>): void {
  const value = message.data;
  if (acceptNativeStorageResponse(value)) {
    return;
  }
  if (isShellCommand(value)) {
    void handleShellCommand(value);
  }
}

function isShellCommand(value: unknown): value is ShellCommand {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const command = candidate.command;
  return (
    candidate.type === 'engine-command' &&
    typeof candidate.id === 'string' &&
    typeof command === 'object' &&
    command !== null &&
    (command as Record<string, unknown>).kind === 'open-local' &&
    typeof (command as Record<string, unknown>).passphrase === 'string' &&
    typeof (command as Record<string, unknown>).actorLabel === 'string' &&
    typeof (command as Record<string, unknown>).workspaceLabel === 'string'
  );
}

function requiredEngine(): Engine {
  if (engine === undefined) {
    throw new Error('Mobile Engine Worker has not started');
  }
  return engine;
}

function randomUuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function describeError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

workerScope.addEventListener('message', receive);
workerScope.addEventListener('unhandledrejection', event => {
  publish({ type: 'engine-error', message: describeError(event.reason) });
});
void start();
