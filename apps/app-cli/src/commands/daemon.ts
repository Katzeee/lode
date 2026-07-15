import { AppServerClient, createSocketTransport } from "@lode/client";
import { type DaemonMeta, readJsonMaybe } from "@lode/daemon/home";
import type { ParsedCli } from "../args.js";
import {
  probeEndpoint,
  resolveDaemonEnv,
  resolveEndpoint,
  spawnDaemonProcess,
} from "../daemon-launch.js";

// The daemon-lifecycle commands. `run` is the foreground daemon itself (the in-process runDaemon —
// also the detached target auto-spawn and `start` launch); `start`/`stop`/`status` manage it. These
// bypass the normal client+auth flow: they never auto-spawn, and only `stop` opens a client (to fire
// `Shutdown`). runDaemon is imported lazily so a plain `lode workspace create` doesn't load engine.
export async function executeDaemonCommand(parsed: ParsedCli, lodeEntry: string): Promise<string> {
  switch (parsed.action) {
    case "run":
      return runDaemonForeground(parsed);
    case "start":
      return startDaemon(parsed, lodeEntry);
    case "stop":
      return stopDaemon(parsed);
    case "status":
      return statusDaemon(parsed);
    default:
      throw new Error(`Unknown command "daemon ${parsed.action}".`);
  }
}

async function runDaemonForeground(parsed: ParsedCli): Promise<never> {
  const env = resolveDaemonEnv(parsed.home);
  const { runDaemon } = await import("@lode/daemon");
  // runDaemon owns the process: it blocks until Shutdown/signal, cleans up, and exits.
  await runDaemon([...parsed.daemonArgs, "--home", env.home]);
  // runDaemon calls process.exit; this is unreachable in practice.
  process.exit(0);
}

async function startDaemon(parsed: ParsedCli, lodeEntry: string): Promise<string> {
  const env = resolveDaemonEnv(parsed.home);
  const endpoint = await resolveEndpoint(env, parsed.url);
  if (await probeEndpoint(endpoint)) {
    return `Daemon already running at ${endpoint}.`;
  }
  // Same locked, fail-fast spawn path as auto-spawn — concurrent `start`/auto-spawn serialize on one
  // daemon, and a crash during startup surfaces immediately instead of hanging.
  const pid = await spawnDaemonProcess(env, endpoint, lodeEntry, parsed.daemonArgs);
  return pid === undefined
    ? `Daemon running at ${endpoint}.`
    : `Daemon started at ${endpoint} (pid ${pid}).`;
}

async function stopDaemon(parsed: ParsedCli): Promise<string> {
  const env = resolveDaemonEnv(parsed.home);
  const endpoint = await resolveEndpoint(env, parsed.url);
  if (!(await probeEndpoint(endpoint))) {
    return "Daemon not running.";
  }
  const meta = await readJsonMaybe<DaemonMeta>(env.paths.daemonJson);
  const client = new AppServerClient(createSocketTransport(endpoint));
  try {
    await client.rpc.shutdown({});
  } catch {
    // Expected: the daemon tears the connection down as it acks. Confirm exit below.
  }
  client.close();
  if (await waitForEndpointGone(endpoint)) {
    return `Daemon stopped (${endpoint}).`;
  }
  // Lingers after Shutdown — fall back to killing the pid, then re-verify.
  if (meta !== undefined) {
    try {
      process.kill(meta.pid);
    } catch {
      // already gone
    }
  }
  if (await waitForEndpointGone(endpoint)) {
    return `Daemon stopped (${endpoint}).`;
  }
  throw new Error(
    meta === undefined
      ? `Daemon at ${endpoint} did not stop.`
      : `Daemon at ${endpoint} (pid ${meta.pid}) did not stop.`,
  );
}

async function statusDaemon(parsed: ParsedCli): Promise<string> {
  const env = resolveDaemonEnv(parsed.home);
  const endpoint = await resolveEndpoint(env, parsed.url);
  const meta = await readJsonMaybe<DaemonMeta>(env.paths.daemonJson);
  if (!(await probeEndpoint(endpoint))) {
    return meta === undefined
      ? "Daemon not running."
      : `Daemon not running (stale metadata for pid ${meta.pid} at ${meta.address}).`;
  }
  const pid = meta?.pid ?? "?";
  const version = meta?.version ?? "unknown";
  return `Daemon running at ${endpoint} (pid ${pid}, version ${version}).`;
}

export async function executeRelayCommand(parsed: ParsedCli, _lodeEntry: string): Promise<string> {
  switch (parsed.action) {
    case "run":
      return runRelayForeground(parsed);
    default:
      throw new Error(`Unknown command "relay ${parsed.action}".`);
  }
}

// Relay-only: `lode relay run [--port <n>] [--tls-cert <p> --tls-key <p>]`. Builds the runDaemon
// relay argv — `--relay` (relay-only trigger, since --listen is absent) + the optional port.
async function runRelayForeground(parsed: ParsedCli): Promise<never> {
  const env = resolveDaemonEnv(parsed.home);
  const { runDaemon } = await import("@lode/daemon");
  const port = parsed.flags["--port"]?.[0];
  const tlsCert = parsed.flags["--tls-cert"]?.[0];
  const tlsKey = parsed.flags["--tls-key"]?.[0];
  const argv = [
    "--relay",
    ...(port === undefined ? [] : [port]),
    ...(tlsCert === undefined ? [] : ["--tls-cert", tlsCert]),
    ...(tlsKey === undefined ? [] : ["--tls-key", tlsKey]),
    "--home",
    env.home,
  ];
  await runDaemon(argv);
  process.exit(0);
}

async function waitForEndpointGone(endpoint: string): Promise<boolean> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!(await probeEndpoint(endpoint))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}
