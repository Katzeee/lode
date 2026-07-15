export type OrderedFlag = {
  name: string;
  value: string;
};

export type ParsedCli = {
  /** Explicit endpoint override: `--url` or `LODE_URL`. Absent → resolve from LODE_HOME. */
  url?: string;
  /** Explicit LODE_HOME (`--home`); absent → platform default. */
  home?: string;
  /** Skip auto-spawning the daemon when the endpoint is unreachable. */
  noAutospawn: boolean;
  /** Temporarily act as this actor id (overrides LODE_HOME/active-actor for this one command). */
  actor?: string;
  group: string;
  /** Bare verbs like `lode unlock`/`lode lock` have no action (empty string). */
  action: string;
  flags: Record<string, string[]>;
  orderedFlags: OrderedFlag[];
  /** Raw passthrough argv for passthrough groups (`daemon`/`config`), handed verbatim to runDaemon. */
  daemonArgs: string[];
};

// Global value flags are extracted wherever they appear (before or after the group). The `daemon`/
// `config` groups are special: their flags are captured RAW for `runDaemon`/config-write to parse,
// instead of the strict `--flag value` shape every other group uses.
const GLOBAL_VALUE_FLAGS = new Set(["--url", "--home", "--actor"]);
const GLOBAL_BOOL_FLAGS = new Set(["--no-autospawn"]);
const PASSTHROUGH_GROUPS = new Set(["daemon", "config"]);

export function parseCli(argv: string[]): ParsedCli {
  const flags: Record<string, string[]> = {};
  const orderedFlags: OrderedFlag[] = [];
  const daemonArgs: string[] = [];
  let url: string | undefined;
  let home: string | undefined;
  let actor: string | undefined;
  let noAutospawn = false;
  let group: string | undefined;
  let action: string | undefined;

  const passthrough = () => group !== undefined && PASSTHROUGH_GROUPS.has(group);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (GLOBAL_BOOL_FLAGS.has(token)) {
      if (token === "--no-autospawn") {
        noAutospawn = true;
      }
      continue;
    }
    if (GLOBAL_VALUE_FLAGS.has(token)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Flag "${token}" requires a value.`);
      }
      if (token === "--url") {
        url = value;
      } else if (token === "--home") {
        home = value;
      } else if (token === "--actor") {
        actor = value;
      }
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      if (passthrough()) {
        daemonArgs.push(token);
        continue;
      }
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Flag "${token}" requires a value.`);
      }
      if (!flags[token]) {
        flags[token] = [];
      }
      flags[token].push(value);
      orderedFlags.push({ name: token, value });
      index += 1;
      continue;
    }

    if (token.startsWith("-")) {
      throw new Error(`Malformed flag "${token}". Use "--flag value" format.`);
    }

    if (!group) {
      group = token;
      continue;
    }
    if (!action) {
      action = token;
      continue;
    }
    if (passthrough()) {
      daemonArgs.push(token);
      continue;
    }
    throw new Error(`Unexpected positional argument "${token}".`);
  }

  const resolvedUrl = url ?? process.env.LODE_URL;
  if (!group) {
    throw new Error("Missing command group.");
  }

  return {
    ...(resolvedUrl === undefined ? {} : { url: resolvedUrl }),
    ...(home === undefined ? {} : { home }),
    noAutospawn,
    ...(actor === undefined ? {} : { actor }),
    group,
    action: action ?? "",
    flags,
    orderedFlags,
    daemonArgs,
  };
}
