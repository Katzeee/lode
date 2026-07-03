export type OrderedFlag = {
  name: string;
  value: string;
};

export type ParsedCli = {
  url: string;
  actorId?: string;
  actorMnemonic?: string;
  group: string;
  action: string;
  flags: Record<string, string[]>;
  orderedFlags: OrderedFlag[];
};

export function parseCli(argv: string[]): ParsedCli {
  const flags: Record<string, string[]> = {};
  const orderedFlags: OrderedFlag[] = [];
  let url: string | undefined;
  let actorId: string | undefined;
  let actorMnemonic: string | undefined;
  let group: string | undefined;
  let action: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (token.startsWith("--")) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Flag "${token}" requires a value.`);
      }

      if (token === "--url") {
        url = value;
      } else if (token === "--actor") {
        actorId = value;
      } else if (token === "--actor-mnemonic") {
        actorMnemonic = value;
      } else {
        if (!flags[token]) {
          flags[token] = [];
        }
        flags[token].push(value);
        orderedFlags.push({ name: token, value });
      }

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

    throw new Error(`Unexpected positional argument "${token}".`);
  }

  const resolvedUrl = url ?? process.env.LODE_URL;
  if (!resolvedUrl) {
    throw new Error('Missing server URL. Provide "--url <url>" or set LODE_URL.');
  }
  // `--actor` / `--actor-mnemonic` are parsed-but-not-enforced here: the bootstrap command
  // (`actor new`) has neither, so the requirement is enforced by the entrypoint (bin/lode.ts),
  // which knows whether a command needs an authenticated session.
  const resolvedActorId = actorId ?? process.env.LODE_ACTOR;
  const resolvedActorMnemonic = actorMnemonic ?? process.env.LODE_ACTOR_MNEMONIC;
  if (!group) {
    throw new Error("Missing command group.");
  }
  if (!action) {
    throw new Error("Missing command action.");
  }

  return {
    url: resolvedUrl,
    ...(resolvedActorId === undefined ? {} : { actorId: resolvedActorId }),
    ...(resolvedActorMnemonic === undefined ? {} : { actorMnemonic: resolvedActorMnemonic }),
    group,
    action,
    flags,
    orderedFlags,
  };
}
