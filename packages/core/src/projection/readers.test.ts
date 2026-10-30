// Purpose: Guards what projected nodes read: the boundary on children, holders and definitions, nested and internal-tag contexts, metanode pointers, and empty fields.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { writeSupport } from "../store/records.ts";
import { writeRelation } from "../store/relations.ts";
import { insertListing } from "../store/listings.ts";
import { child, command, id, node, replicas, sync, type Replica } from "../graph/graph.test-support.ts";
import { supertags, tag } from "../tags/tags.test-support.ts";
import { addressKey, sameAddress, type NodeAddress, type Projected } from "./address.ts";
import { associatedSubjectAt, holderAt, holdersAt } from "./holders.ts";
import { mergedList } from "./merged.ts";
import { outlineLines } from "./outline.ts";
import { children, field, template } from "./projection.test-support.ts";
import { showsAsEmptyField } from "./empty-field.ts";
import { childrenOf, definitionAt, metanodeAt, ownerAt } from "./readers.ts";
import { hasValidTemplateAt, templatesAt, templateSourcesAt } from "./tag-reads.ts";
import { templates } from "../tags/templates.ts";

const at = (instance: NodeAddress, source: string, root = source, mode: Projected["mode"] = "template"): Projected => ({
  instance,
  root: id(root),
  source: id(source),
  mode,
});
const shown = (r: Replica, address: NodeAddress) =>
  childrenOf(r, address).map((line) => [addressKey(line.node), line.link]);

/** Template A with child R; R owns c, and c owns d. R also lists d (internal) and X (external). */
function fixture(): Replica {
  const [r] = replicas([{ name: "I" }, { name: "J" }, { name: "X" }]);
  template(r!, "A", "R");
  children(r!, "R", "c");
  children(r!, "c", "d");
  command(r!, [], (cmd) => {
    insertListing(r!.store, id("R"), id("d"), 1);
    insertListing(r!.store, id("R"), id("X"), 2);
    writeSupport(node(r!, "R"), cmd);
  });
  tag(r!, "I", ["A"]);
  tag(r!, "J", ["A"]);
  return r!;
}

test("inside the boundary children are projected, even through a reference; outside they are real", () => {
  const r = fixture();
  const projectedR = at(id("I"), "R");
  deepStrictEqual(shown(r, projectedR), [
    [addressKey(at(id("I"), "c", "R")), "original"],
    [addressKey(at(id("I"), "d", "R")), "reference"],
    [id("X"), "reference"],
  ]);
  strictEqual(
    addressKey(at(id("J"), "R")) === addressKey(projectedR),
    false,
    "two instances of one template show two different nodes",
  );
});

test("a projected node's own tag nests its template content in the projected context", () => {
  const r = fixture();
  template(r, "B", "z");
  tag(r, "c", ["B"]);
  const projectedC = at(id("I"), "c", "R");
  const nested = outlineLines(r, projectedC).map((line) => addressKey(line.node));
  deepStrictEqual(nested, [addressKey(at(projectedC, "z")), addressKey(at(id("I"), "d", "R"))]);
});

test("a template field shows one projected empty value; initialization and supertag instances read the default", () => {
  const [r] = replicas([{ name: "I" }, { name: "S" }, { name: "F" }]);
  template(r!, "A");
  field(r!, "A", "T", "F", "default");
  tag(r!, "I", ["A"]);
  supertags(r!, "S");
  tag(r!, "S", ["supertag", "A"], "S:meta2");

  const [outline] = mergedList(r!, id("I"), { kind: "outline" });
  deepStrictEqual(outline!.node, at(id("I"), "T", "T", "emptyField"));
  deepStrictEqual(shown(r!, outline!.node), [[addressKey(at(id("I"), "emptyValue", "T", "emptyField")), "original"]]);

  const [initialized] = mergedList(r!, id("I"), { kind: "initialization", materializeDefaults: true });
  deepStrictEqual(shown(r!, initialized!.node), [[addressKey(at(id("I"), "default", "T")), "original"]]);
  const [unmaterialized] = mergedList(r!, id("I"), { kind: "initialization", materializeDefaults: false });
  strictEqual((unmaterialized!.node as Projected).mode, "emptyField");

  const [onSupertag] = mergedList(r!, id("S"), { kind: "outline" });
  strictEqual((onSupertag!.node as Projected).mode, "template");
});

test("holder enumeration bounds holders, direct lookup always projects, and a real holder keeps its subject", () => {
  const r = fixture();
  command(r, [child("inner", "R", { listed: false }), child("outer", "X", { listed: false })], (cmd) => {
    writeRelation(r.store, node(r, "R"), { type: "assoc", subject: id("c"), holder: id("inner") }, cmd);
    writeRelation(r.store, node(r, "R"), { type: "assoc", subject: id("X"), holder: id("outer") }, cmd);
    writeSupport(node(r, "R"), cmd);
  });
  const projectedR = at(id("I"), "R");

  deepStrictEqual(
    holdersAt(r, projectedR).map(addressKey).sort(),
    [addressKey(at(id("I"), "inner", "R")), id("outer")].sort(),
  );
  deepStrictEqual(associatedSubjectAt(r, at(id("I"), "inner", "R")), at(id("I"), "c", "R"));
  strictEqual(associatedSubjectAt(r, id("outer")), id("X"));
  deepStrictEqual(holderAt(r, projectedR, id("X")), at(id("I"), "outer", "R"));
});

test("a supertag inside the template is read through the projection: its sources and children keep the outer context", () => {
  const [r] = replicas([{ name: "I" }]);
  template(r!, "A", "R");
  children(r!, "R", "C", "B");
  supertags(r!, "B");
  children(r!, "B", "Z");
  tag(r!, "C", ["B"]);
  tag(r!, "I", ["A"]);

  const projectedC = at(id("I"), "C", "R");
  const projectedB = at(id("I"), "B", "R");
  deepStrictEqual(templateSourcesAt(r!, projectedC, "outline"), [projectedB]);
  deepStrictEqual(templateSourcesAt(r!, projectedC, "initialization"), [projectedB]);
  const projectedZ = at(id("I"), "Z", "R");
  deepStrictEqual(
    outlineLines(r!, projectedC).map((line) => line.node),
    [{ instance: projectedC, root: projectedZ, source: projectedZ, mode: "template" }],
  );
});

test("a metanode another node owns is no metanode for the real node or its projection", () => {
  const [r] = replicas([{ name: "I" }, { name: "X" }]);
  template(r!, "A", "R");
  template(r!, "B");
  tag(r!, "X", ["B"], "M");
  command(r!, [], (cmd) => {
    writeRelation(r!.store, node(r!, "R"), { type: "meta", target: id("M") }, cmd);
    writeSupport(node(r!, "R"), cmd);
  });
  tag(r!, "I", ["A"]);

  deepStrictEqual([metanodeAt(r!, id("R")), templates(r!, id("R"))], [undefined, undefined]);
  deepStrictEqual(
    [metanodeAt(r!, at(id("I"), "R")), templatesAt(r!, at(id("I"), "R")), hasValidTemplateAt(r!, at(id("I"), "R"))],
    [undefined, undefined, false],
  );
});

test("a definition endpoint inside the template is projected unless it is a field definition", () => {
  const [r] = replicas([{ name: "I" }]);
  template(r!, "A", "R");
  children(r!, "R", "D", "FD");
  tag(r!, "FD", ["fieldDefinition"]);
  field(r!, "R", "T1", "D", "v1");
  field(r!, "R", "T2", "FD", "v2");
  tag(r!, "I", ["A"]);

  deepStrictEqual(definitionAt(r!, at(id("I"), "T1", "R")), at(id("I"), "D", "R"));
  strictEqual(definitionAt(r!, at(id("I"), "T2", "R")), id("FD"));
});

test("a field whose definition endpoint is itself a tuple never shows as an empty field", () => {
  const [r] = replicas([{ name: "I" }, { name: "X" }]);
  template(r!, "A");
  field(r!, "A", "D", "X", "DV");
  tag(r!, "D", ["fieldDefinition"]);
  field(r!, "A", "T", "D", "V");
  tag(r!, "I", ["A"]);
  strictEqual(showsAsEmptyField(r!, id("I"), id("T")), false);
});

test("nested projections keep their layering in identity: same structure is equal, different nesting is not", () => {
  const [r] = replicas([{ name: "A" }, { name: "B" }, { name: "C" }]);
  const left = at(at(id("A"), "B"), "C");
  const right = at(id("A"), "C", "C");
  const rightNested: Projected = {
    instance: id("A"),
    root: at(id("B"), "C"),
    source: at(id("B"), "C"),
    mode: "template",
  };
  strictEqual(sameAddress(left, rightNested), false);
  deepStrictEqual([ownerAt(r!, left), ownerAt(r!, rightNested)], [at(id("A"), "B"), id("A")]);
  strictEqual(sameAddress(left, at(at(id("A"), "B"), "C")), true, "an independent object of the same structure");
  strictEqual(sameAddress(right, left), false);
});

test("a projected node folds every metanode candidate, and an undone candidate drops out", () => {
  const [a, b] = replicas([{ name: "I" }, { name: "T1" }, { name: "T2" }]);
  template(a!, "A", "R");
  supertags(a!, "T1", "T2");
  tag(a!, "I", ["A"]);
  sync(a!, b!);
  tag(a!, "R", ["T1"], "M1");
  tag(b!, "R", ["T2"], "M2");
  sync(a!, b!);

  for (const r of [a!, b!]) {
    deepStrictEqual(templates(r, id("R")), [id("T1"), id("T2")]);
    deepStrictEqual(templatesAt(r, at(id("I"), "R")), [id("T1"), id("T2")]);
  }
  b!.undo.undo();
  sync(a!, b!);
  deepStrictEqual(templatesAt(a!, at(id("I"), "R")), [id("T1")]);
});

/** An application `app` of R in a new metanode `meta`, holding an owned empty value and references, in order. */
function application(r: Replica, meta: string, app: string, values: string[]): void {
  command(
    r,
    [
      child(meta, "R", { listed: false, kind: "metanode" }),
      child(app, meta, { kind: "tuple", tupleDefinitionId: id("tags") }),
      ...values.filter((value) => value.startsWith("E")).map((value) => child(value, app)),
    ],
    () =>
      values.forEach((value, index) => {
        if (!value.startsWith("E")) {
          insertListing(r.store, id(app), id(value), index);
        }
      }),
    [{ host: id("R"), relation: { type: "meta", target: id(meta) } }],
  );
}

for (const [label, first, second] of [
  ["a valueless first application is the seed", [], ["E2", "T1"]],
  ["an empty first value is replaced before a repeated reference merges", ["E1", "T1"], ["T1"]],
] as const) {
  test(`projected and stored tag reads fold alike: ${label}`, () => {
    const [a, b] = replicas([{ name: "I" }, { name: "T1" }]);
    template(a!, "A", "R");
    supertags(a!, "T1");
    tag(a!, "I", ["A"]);
    sync(a!, b!);
    application(a!, "M1", "A1", [...first]);
    application(b!, "M2", "A2", [...second]);
    sync(a!, b!);

    deepStrictEqual(templates(a!, id("R")), [id("T1")], "stored");
    deepStrictEqual(templatesAt(a!, at(id("I"), "R")), [id("T1")], "projected");
  });
}
