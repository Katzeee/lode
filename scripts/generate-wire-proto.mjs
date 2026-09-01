// Generates the wire vocabulary from the engine's edit and action registries.
//
// The registries are the source of truth for the public edit surface: every registry edit's
// declared fields (edit-catalog) and every direct-access action's fields (action-catalog) carry a
// wire type, and this script renders them as edit.proto messages plus the EditAction oneof, and
// splices the FactActionKind enum (all non-terminal action kinds) into review.proto. Field, oneof,
// and enum numbers are preserved by parsing the currently committed protos; new entries get the
// next free number, so regeneration never renumbers silently.
//
// Requires the engine to be built (imports its dist). Modes:
//   node scripts/generate-wire-proto.mjs           # rewrite the committed protos
//   node scripts/generate-wire-proto.mjs --check   # fail if the committed protos are stale
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const EDIT_PROTO_PATH = fileURLToPath(new URL("../packages/protocol/protos/lode/edit.proto", import.meta.url));
const REVIEW_PROTO_PATH = fileURLToPath(new URL("../packages/protocol/protos/lode/review.proto", import.meta.url));
const ENGINE_DIST = new URL("../packages/engine/dist/domain/", import.meta.url);

const { EDIT_DEFINITIONS } = await import(new URL("edit/edit-catalog.js", ENGINE_DIST));
const { ACTION_DEFINITIONS } = await import(new URL("fact/action-catalog.js", ENGINE_DIST));

const definitions = collectWireDefinitions();
const existing = parseExistingProto(await readFile(EDIT_PROTO_PATH, "utf8"));
const renderedEdit = renderProto(definitions, existing);
const committedReview = await readFile(REVIEW_PROTO_PATH, "utf8");
const renderedReview = spliceFactActionKindEnum(committedReview);

if (process.argv.includes("--check")) {
  const committedEdit = await readFile(EDIT_PROTO_PATH, "utf8");
  const stale = [
    ...(committedEdit === renderedEdit ? [] : ["edit.proto"]),
    ...(committedReview === renderedReview ? [] : ["review.proto"]),
  ];
  if (stale.length > 0) {
    console.error(`${stale.join(", ")} stale against the engine registries: run \`npm run generate:wire\`.`);
    process.exit(1);
  }
  console.log("Wire protos match the engine registries.");
} else {
  await writeFile(EDIT_PROTO_PATH, renderedEdit);
  await writeFile(REVIEW_PROTO_PATH, renderedReview);
  console.log(`Wrote ${EDIT_PROTO_PATH} and the FactActionKind enum in ${REVIEW_PROTO_PATH}`);
}

/** Rewrites review.proto's FactActionKind enum from the action registry, preserving numbers. */
function spliceFactActionKindEnum(source) {
  const block = /enum FactActionKind \{[^}]*\}/s.exec(source);
  if (!block) {
    throw new Error("review.proto has no FactActionKind enum to regenerate");
  }
  const numbers = new Map();
  for (const [, memberName, number] of block[0].matchAll(/(\w+) = (\d+);/g)) {
    numbers.set(memberName, Number(number));
  }
  let nextNumber = Math.max(...numbers.values()) + 1;
  const lines = ["enum FactActionKind {", "  FACT_ACTION_KIND_UNSPECIFIED = 0;"];
  const members = [];
  for (const family of Object.values(ACTION_DEFINITIONS)) {
    for (const definition of Object.values(family)) {
      if (definition.admission === "terminal") {
        continue;
      }
      const memberName = `FACT_ACTION_KIND_${definition.kind.replaceAll("-", "_").toUpperCase()}`;
      members.push({ memberName, number: numbers.get(memberName) ?? nextNumber++ });
    }
  }
  members.sort((left, right) => left.number - right.number);
  for (const member of members) {
    lines.push(`  ${member.memberName} = ${member.number};`);
  }
  lines.push("}");
  return source.replace(block[0], lines.join("\n"));
}

/** @returns {readonly {kind: string, fields: readonly {name: string, optional: boolean, wire: any}[]}[]} */
function collectWireDefinitions() {
  const collected = [];
  for (const family of Object.values(EDIT_DEFINITIONS)) {
    for (const definition of Object.values(family)) {
      collected.push({ kind: definition.kind, fields: wireFields(definition.kind, definition.fields) });
    }
  }
  for (const family of Object.values(ACTION_DEFINITIONS)) {
    for (const definition of Object.values(family)) {
      if (definition.editAccess !== "direct") {
        continue;
      }
      collected.push({ kind: definition.kind, fields: wireFields(definition.kind, definition.fields) });
    }
  }
  const byKind = new Map();
  for (const definition of collected) {
    if (byKind.has(definition.kind)) {
      throw new Error(`Edit wire vocabulary declares ${definition.kind} twice`);
    }
    byKind.set(definition.kind, definition);
  }
  return collected;
}

function wireFields(kind, fields) {
  return Object.entries(fields).map(([name, field]) => {
    if (field.wire === undefined) {
      throw new Error(`${kind}.${name} reaches the edit wire but declares no wire type`);
    }
    return { name, optional: field.optional === true, wire: field.wire };
  });
}

/** Parses message field numbers and the EditAction oneof numbers out of the committed proto. */
function parseExistingProto(source) {
  const fieldNumbers = new Map();
  const messagePattern = /message (\w+) \{([^}]*)\}/gs;
  for (const [, messageName, body] of source.matchAll(messagePattern)) {
    const numbers = new Map();
    for (const [, fieldName, number] of body.matchAll(/(\w+) = (\d+);/g)) {
      numbers.set(fieldName, Number(number));
    }
    fieldNumbers.set(messageName, numbers);
  }
  const oneofNumbers = new Map();
  const oneofBody = /oneof action \{([^}]*)\}/s.exec(source)?.[1] ?? "";
  for (const [, fieldName, number] of oneofBody.matchAll(/(\w+) = (\d+);/g)) {
    oneofNumbers.set(fieldName, Number(number));
  }
  return { fieldNumbers, oneofNumbers };
}

function renderProto(definitions, existing) {
  const lines = [
    "// Generated from the engine edit and action registries by scripts/generate-wire-proto.mjs.",
    "// Do not edit by hand: change the registry definitions and run `npm run generate:wire`.",
    'syntax = "proto3";',
    "",
    "package lode;",
    "",
    'import "google/protobuf/struct.proto";',
    'import "google/protobuf/wrappers.proto";',
    'import "lode/model.proto";',
    "",
  ];
  const ordered = orderByOneof(definitions, existing.oneofNumbers);
  for (const definition of ordered) {
    lines.push(...renderMessage(definition, existing.fieldNumbers));
    lines.push("");
  }
  lines.push("message EditAction {");
  lines.push("  oneof action {");
  let nextOneofNumber = Math.max(0, ...existing.oneofNumbers.values()) + 1;
  for (const definition of ordered) {
    const fieldName = snakeCase(definition.kind);
    const number = existing.oneofNumbers.get(fieldName) ?? nextOneofNumber++;
    lines.push(`    ${messageName(definition.kind)} ${fieldName} = ${number};`);
  }
  lines.push("  }");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

/** Keeps the committed oneof order for existing kinds and appends new kinds at the end. */
function orderByOneof(definitions, oneofNumbers) {
  return [...definitions].sort((left, right) => {
    const leftNumber = oneofNumbers.get(snakeCase(left.kind)) ?? Number.MAX_SAFE_INTEGER;
    const rightNumber = oneofNumbers.get(snakeCase(right.kind)) ?? Number.MAX_SAFE_INTEGER;
    return leftNumber - rightNumber || left.kind.localeCompare(right.kind);
  });
}

function renderMessage(definition, fieldNumbers) {
  const name = messageName(definition.kind);
  const numbers = fieldNumbers.get(name) ?? new Map();
  let nextNumber = Math.max(0, ...numbers.values()) + 1;
  const lines = [`message ${name} {`];
  for (const field of definition.fields) {
    const fieldName = snakeCase(field.name);
    const number = numbers.get(fieldName) ?? nextNumber++;
    lines.push(`  ${renderFieldType(field)} ${fieldName} = ${number};`);
  }
  lines.push("}");
  return lines;
}

function renderFieldType(field) {
  const optional = field.optional ? "optional " : "";
  const wire = field.wire;
  switch (wire.kind) {
    case "scalar":
      return `${optional}${wire.scalar}`;
    case "message":
      return `${optional}${wire.message}`;
    case "enum":
      return `${optional}${wire.enum}`;
    case "string-value":
      return `${optional}google.protobuf.StringValue`;
    case "string-list":
      return "repeated string";
    case "json-map":
      return "map<string, google.protobuf.Value> ".trimEnd();
    default:
      throw new Error(`Unknown wire type ${JSON.stringify(wire)}`);
  }
}

function messageName(kind) {
  return `${kind
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("")}Action`;
}

function snakeCase(name) {
  return name.replaceAll("-", "_").replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
