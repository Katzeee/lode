import {
  ApplicationSession,
  dispatchApplicationRequest,
} from '@lode/application/host';
import type { PeerTransportPort } from '@lode/engine';
import { createMobileEngine } from '@lode/engine-platform-mobile';
import type { HostMessage } from './protocol.js';
import {
  acceptNativeStorageResponse,
  nativePersistence,
} from './native-persistence.js';

const scope = globalThis as unknown as {
  postMessage(message: HostMessage): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
};
const peerTransport: PeerTransportPort = {
  start: () => {},
  dial: () => {
    throw new Error('Mobile peer transport is not configured');
  },
  close: () => {},
};
const engine = createMobileEngine({
  persistence: nativePersistence,
  peerTransport,
});
const ready = engine.start().then(() => {
  const session = new ApplicationSession(engine.api);
  session.onStateChanged(state =>
    scope.postMessage({
      type: 'application-event',
      event: { kind: 'state', state },
    }),
  );
  session.engine.subscribe(
    event =>
      scope.postMessage({
        type: 'application-event',
        event: { kind: 'engine', event },
      }),
    error =>
      scope.postMessage({
        type: 'application-event',
        event: { kind: 'error', message: describe(error) },
      }),
  );
  return session;
});
void ready.catch((error: unknown) =>
  scope.postMessage({
    type: 'application-event',
    event: { kind: 'error', message: describe(error) },
  }),
);
scope.addEventListener('message', event => {
  if (acceptNativeStorageResponse(event.data)) {
    return;
  }
  const data = event.data;
  if (
    typeof data !== 'object' ||
    data === null ||
    !('type' in data) ||
    data.type !== 'application-request' ||
    !('id' in data) ||
    typeof data.id !== 'string' ||
    !('method' in data) ||
    typeof data.method !== 'string'
  ) {
    return;
  }
  const { id, method } = data;
  const input = 'input' in data ? data.input : undefined;
  void ready
    .then(session => dispatchApplicationRequest(session, method, input))
    .then(
      value =>
        scope.postMessage({
          type: 'application-response',
          id,
          ok: true,
          value,
        }),
      (error: unknown) =>
        scope.postMessage({
          type: 'application-response',
          id,
          ok: false,
          error: describe(error),
        }),
    );
});
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
