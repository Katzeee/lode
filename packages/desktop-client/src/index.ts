export { createDesktopClient } from "./desktop-client.js";
export type { DaemonStatusView, DesktopClient } from "./desktop-client.js";
export { describeError } from "./errors.js";
export {
  ensureRunningDaemon,
  HomeConfigurationError,
  homeConnectionFiles,
  probeDaemon,
  selectHome,
  type DaemonLauncher,
  type EnsureRunningOptions,
  type HomeConnectionFiles,
  type HomeSelection,
} from "./home-connection.js";
export {
  assertHomePathAvailable,
  homeNamePattern,
  lodeConfigDir,
  normalizeHomePath,
  readHomeRegistry,
  registryFile,
  writeHomeRegistry,
  type HomeEntry,
  type HomeRegistryDocument,
  type HomeRegistryFile,
} from "./home-registry.js";
