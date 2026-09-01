export type { DaemonStatusView, DesktopClient } from "./desktop-client.js";
export {
  ensureRunningDaemon,
  HomeConfigurationError,
  probeDaemon,
  selectHome,
  type HomeSelection,
} from "./home-connection.js";
export {
  homeNamePattern,
  lodeConfigDir,
  normalizeHomePath,
  readHomeRegistry,
  registeredHomeAtPath,
  registryFile,
  writeHomeRegistry,
  type HomeRegistryFile,
} from "./home-registry.js";
