import type { ComponentDefinition } from "../kernel/component.js";
import type { RuntimeConfig } from "../config.js";
import type { EngineServices } from "../services.js";
import { VaultRuntime } from "./vault.js";

// The identity vault as a runtime singleton. Available when `config.vault.path` is set (socket
// deployment); an in-process/test runtime omits it, leaving the vault unavailable (auth flows through
// `sessionHello` instead). Always constructed — `resolveCaller` branches on `vault.available`.
export const vaultComponent: ComponentDefinition<EngineServices, "vault", never, RuntimeConfig> = {
  name: "vault",
  create: async ({ config }) => {
    const ttl = config.vault?.ttl;
    return VaultRuntime.load(config.vault?.path, ttl === undefined ? {} : { ttl });
  },
};
