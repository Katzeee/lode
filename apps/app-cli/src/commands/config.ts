import { atomicWrite, readJsonMaybe } from "@lode/daemon/home";
import type { ParsedCli } from "../args.js";
import { resolveDaemonEnv } from "../daemon-launch.js";

// `lode config <key> <value>` — daemon-config writes (no daemon needs to be running; this edits
// LODE_HOME/config.json directly). `unlock-ttl` sets the vault lease policy the daemon reads at start.
export async function executeConfigCommand(parsed: ParsedCli): Promise<string> {
  switch (parsed.action) {
    case "unlock-ttl":
      return configUnlockTtl(parsed);
    default:
      throw new Error(`Unknown command "config ${parsed.action}".`);
  }
}

async function configUnlockTtl(parsed: ParsedCli): Promise<string> {
  const value = parsed.daemonArgs[0];
  if (value === undefined) {
    throw new Error("Usage: lode config unlock-ttl <always|duration:<ms>|session>");
  }
  if (!/^(always|session|duration:\d+)$/.test(value)) {
    throw new Error(`invalid unlock-ttl "${value}" (expected always | duration:<ms> | session)`);
  }
  const env = resolveDaemonEnv(parsed.home);
  // Read-modify-write so other config keys survive (config.json will grow beyond unlock-ttl).
  const existing = (await readJsonMaybe<Record<string, unknown>>(env.paths.config)) ?? {};
  existing.unlockTtl = value;
  await atomicWrite(env.paths.config, `${JSON.stringify(existing, null, 2)}\n`);
  return `unlock-ttl set to ${value} (restart the daemon to apply).`;
}
