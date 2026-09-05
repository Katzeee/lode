import type {
  ApplicationConnection,
  ApplicationEvent,
} from '@lode/application/host';
import { parseNativeStorageRequest } from './host-message.js';
import { executeStorageOperation } from './native-database.js';
import type {
  HostMessage,
  NativeStorageRequest,
  NativeStorageResponse,
} from './engine-worker/protocol.js';

export function createMobileConnection(): ApplicationConnection &
  Readonly<{ dispose(): void }> {
  const worker = new Worker('./engine-worker/index.js');
  const listeners = new Set<(event: ApplicationEvent) => void>();
  const pending = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure = error;
    for (const task of pending.values()) {
      task.reject(error);
    }
    pending.clear();
    for (const listener of listeners) {
      listener({ kind: 'error', message: error.message });
    }
  };
  const storage = async (request: NativeStorageRequest) => {
    let response: NativeStorageResponse;
    try {
      response = {
        type: 'native-storage-response',
        id: request.id,
        ok: true,
        value: await executeStorageOperation(request.operation),
      };
    } catch (error) {
      response = {
        type: 'native-storage-response',
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    worker.postMessage(response);
  };
  worker.addEventListener('message', (event: MessageEvent<HostMessage>) => {
    const data = event.data;
    switch (data.type) {
      case 'native-storage-request':
        try {
          void storage(parseNativeStorageRequest(data));
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
        break;
      case 'application-event':
        for (const listener of listeners) {
          listener(data.event);
        }
        break;
      case 'application-response': {
        const task = pending.get(data.id);
        if (!task) {
          return;
        }
        pending.delete(data.id);
        if (data.ok) {
          task.resolve(data.value);
        } else {
          task.reject(new Error(data.error ?? 'Application request failed'));
        }
        break;
      }
    }
  });
  worker.addEventListener('error', event => fail(new Error(event.message)));
  worker.addEventListener('messageerror', () =>
    fail(new Error('Unable to decode Engine Worker message')),
  );
  return {
    request: (method, input) =>
      new Promise((resolve, reject) => {
        if (failure) {
          reject(failure);
          return;
        }
        const id = crypto.randomUUID();
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'application-request', id, method, input });
      }),
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      worker.terminate();
      fail(new Error('Mobile Engine stopped'));
      listeners.clear();
    },
  };
}
