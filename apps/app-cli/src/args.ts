export type OrderedFlag = {
  name: string;
  value: string;
};

export type ParsedCli = {
  url: string;
  actorId: string;
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
  const resolvedActorId = actorId ?? process.env.LODE_ACTOR;
  if (!resolvedActorId) {
    throw new Error('Missing actor. Provide "--actor <id>" or set LODE_ACTOR.');
  }
  if (!group) {
    throw new Error("Missing command group.");
  }
  if (!action) {
    throw new Error("Missing command action.");
  }

  return {
    url: resolvedUrl,
    actorId: resolvedActorId,
    group,
    action,
    flags,
    orderedFlags,
  };
}
