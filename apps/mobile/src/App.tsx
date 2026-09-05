import { LodeApp, connectApplication } from '@lode/application';
import { createMobileConnection } from './engine-worker-client.js';

// The connection belongs to the host lifetime, independently of React mount cycles.
const connection = createMobileConnection();
const host = connectApplication(connection);
window.addEventListener('pagehide', event => {
  if (!event.persisted) {
    connection.dispose();
  }
});
export default function App() {
  return <LodeApp host={host} />;
}
