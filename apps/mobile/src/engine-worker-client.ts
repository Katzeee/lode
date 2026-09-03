import type {
  EngineHostState,
  NativeStorageResponse,
  ShellCommand,
} from './engine-worker/protocol.js';
import { describeError, parseHostMessage } from './host-message.js';
import { executeStorageOperation } from './native-database.js';

type StateListener = (state: EngineHostState) => void;
type ErrorListener = (message: string) => void;

export type MobileEngineClient = Readonly<{
  dispose(): void;
  onError(listener: ErrorListener): () => void;
  onState(listener: StateListener): () => void;
  openLocal(input: ShellCommand['command']): Promise<EngineHostState>;
}>;

export function createMobileEngineClient(): MobileEngineClient {
  const worker = new Worker('./engine-worker/index.js');
  const stateListeners = new Set<StateListener>();
  const errorListeners = new Set<ErrorListener>();
  let latestState: EngineHostState | undefined;
  const pending = new Map<
    string,
    Readonly<{
      reject(error: Error): void;
      resolve(state: EngineHostState): void;
    }>
  >();

  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    let message;
    try {
      message = parseHostMessage(event.data);
    } catch (error) {
      publishError(describeError(error));
      return;
    }
    if (message.type === 'native-storage-request') {
      void respondToStorage(message.id, message.operation);
      return;
    }
    if (message.type === 'engine-state') {
      latestState = message.state;
      for (const listener of stateListeners) {
        listener(message.state);
      }
      return;
    }
    if (message.type === 'engine-error') {
      publishError(message.message);
      return;
    }
    const task = pending.get(message.id);
    if (task === undefined) {
      return;
    }
    pending.delete(message.id);
    if (message.ok && message.state !== undefined) {
      task.resolve(message.state);
    } else {
      task.reject(new Error(message.error ?? 'The Engine command failed'));
    }
  });

  worker.addEventListener('error', event => publishError(event.message));

  const respondToStorage = async (
    id: string,
    operation: Parameters<typeof executeStorageOperation>[0],
  ): Promise<void> => {
    let response: NativeStorageResponse;
    try {
      response = {
        type: 'native-storage-response',
        id,
        ok: true,
        value: await executeStorageOperation(operation),
      };
    } catch (error) {
      response = {
        type: 'native-storage-response',
        id,
        ok: false,
        error: describeError(error),
      };
    }
    worker.postMessage(response);
  };

  function publishError(message: string): void {
    for (const listener of errorListeners) {
      listener(message);
    }
  }

  return {
    dispose() {
      worker.terminate();
      for (const task of pending.values()) {
        task.reject(new Error('The mobile Engine Worker stopped'));
      }
      pending.clear();
    },
    onError(listener) {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    onState(listener) {
      stateListeners.add(listener);
      if (latestState !== undefined) {
        listener(latestState);
      }
      return () => stateListeners.delete(listener);
    },
    openLocal(command) {
      const id = `open-${crypto.randomUUID()}`;
      return new Promise((resolve, reject) => {
        pending.set(id, { reject, resolve });
        worker.postMessage({
          type: 'engine-command',
          id,
          command,
        } satisfies ShellCommand);
      });
    },
  };
}
