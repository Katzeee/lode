import { okOutcome } from "../outcome/index.js";
import type { CommandCatalog, CommandDefinition } from "../catalog/index.js";

/**
 * Identity family: non-interactive Actor and Peer identity management. Every
 * secret enters through stdin or a controlled file (`--passphrase-file -`
 * reads stdin); the recovery phrase is printed exactly once, at creation.
 */

const PASSPHRASE_FILE = {
  name: "--passphrase-file",
  description: "File holding the vault passphrase ('-' for stdin)",
  value: { kind: "file" as const },
  required: true,
};

const PHRASE_FILE = {
  name: "--phrase-file",
  description: "File holding the BIP-39 recovery phrase ('-' for stdin)",
  value: { kind: "file" as const },
  required: true,
};

export function registerIdentityCommands(catalog: CommandCatalog): void {
  catalog.register(identityCreate);
  catalog.register(identityImport);
  catalog.register(identityList);
  catalog.register(identityUnlock);
  catalog.register(identityLock);
  catalog.register(identityExport);
}

const identityCreate: CommandDefinition = {
  path: ["identity", "create"],
  summary: "Create a new Actor and print its recovery phrase once.",
  positionals: [["label", "Display label for the Actor"]],
  options: [PASSPHRASE_FILE],
  kind: "write",
  paginated: false,
  needsWorkspace: false,
  run: async (context, args) => {
    const created = await context.session.identity.create({
      label: args.positional("label"),
      passphrase: args.requiredOption("--passphrase-file"),
    });
    return okOutcome(
      { actor: { actorId: created.actorId, recoveryPhrase: created.recoveryPhrase } },
      {
        view: {
          kind: "text",
          lines: [
            `Created Actor ${created.actorId}.`,
            `Recovery phrase (shown once): ${created.recoveryPhrase}`,
            "Import it on another Home with `lode identity import`.",
          ],
        },
      },
    );
  },
};

const identityImport: CommandDefinition = {
  path: ["identity", "import"],
  summary: "Restore an Actor from its recovery phrase.",
  positionals: [["label", "Display label for the Actor"]],
  options: [PASSPHRASE_FILE, PHRASE_FILE],
  kind: "write",
  paginated: false,
  needsWorkspace: false,
  run: async (context, args) => {
    const imported = await context.session.identity.importActor({
      label: args.positional("label"),
      passphrase: args.requiredOption("--passphrase-file"),
      recoveryPhrase: args.requiredOption("--phrase-file"),
    });
    return okOutcome(
      { actor: { actorId: imported.actorId } },
      {
        view: {
          kind: "text",
          lines: [`Imported Actor ${imported.actorId}.`, "Unlock the vault before creating or writing."],
        },
      },
    );
  },
};

const identityList: CommandDefinition = {
  path: ["identity", "list"],
  summary: "List Actors held by this Home and their unlock state.",
  positionals: [],
  options: [],
  kind: "read",
  paginated: false,
  needsWorkspace: false,
  run: async (context) => {
    const listed = await context.session.identity.list();
    return okOutcome(
      {
        vaultExists: listed.vaultExists,
        items: listed.actors.map((actor) => ({
          actorId: actor.actorId,
          label: actor.label,
          createdAt: actor.createdAt,
          unlocked: actor.unlocked,
        })),
      },
      {
        view: {
          kind: "table",
          columns: ["actor", "label", "unlocked"],
          rows: listed.actors.map((actor) => [actor.actorId, actor.label, actor.unlocked ? "unlocked" : "locked"]),
        },
      },
    );
  },
};

const identityUnlock: CommandDefinition = {
  path: ["identity", "unlock"],
  summary: "Unlock the Actor Vault with its passphrase.",
  positionals: [],
  options: [PASSPHRASE_FILE],
  kind: "write",
  paginated: false,
  needsWorkspace: false,
  run: async (context, args) => {
    const unlocked = await context.session.identity.unlock(args.requiredOption("--passphrase-file"));
    return okOutcome(
      {
        unlocked: unlocked.actors.filter((actor) => actor.unlocked).map((actor) => actor.actorId),
        actors: unlocked.actors.map((actor) => ({ actorId: actor.actorId, unlocked: actor.unlocked })),
      },
      {
        view: {
          kind: "text",
          lines: [
            `Vault unlocked with ${unlocked.actors.filter((actor) => actor.unlocked).length} Actor(s) available.`,
          ],
        },
      },
    );
  },
};

const identityLock: CommandDefinition = {
  path: ["identity", "lock"],
  summary: "Lock the Actor Vault; signing stops, sync continues.",
  positionals: [],
  options: [],
  kind: "write",
  paginated: false,
  needsWorkspace: false,
  run: async (context) => {
    await context.session.identity.lock();
    return okOutcome({ locked: true }, { view: { kind: "text", lines: ["Vault locked."] } });
  },
};

const identityExport: CommandDefinition = {
  path: ["identity", "export"],
  summary: "Print this Home's admission material (public keys only).",
  positionals: [],
  options: [],
  kind: "read",
  paginated: false,
  needsWorkspace: false,
  run: async (context) => {
    const material = await context.session.identity.peerMaterial();
    return okOutcome(
      { admission: material },
      {
        view: {
          kind: "text",
          lines: [
            "Admission material (public keys only; safe to hand to a member):",
            JSON.stringify(material, null, 2),
            "A member admits it with `lode workspace admit-peer --admission-file -`.",
          ],
        },
      },
    );
  },
};
