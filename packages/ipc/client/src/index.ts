export {
  AppServerClient,
  createSocketTransport,
  createInProcessTransport,
} from "./app-server-client.js";
export type {
  AppServerTransport,
  AuthenticateOptions,
  InProcessCommands,
  LodeCommandsClient,
  NotificationHandler,
  SocketDial,
} from "./app-server-client.js";
export { describeError, isVaultLockedError } from "./errors.js";
