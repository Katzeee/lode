// Purpose: Guards the tag fold across concurrent first applications: both replicas' tags stay readable and an empty first application never hides them.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { createLeaf } from "../store/store.ts";
import { child, command, id, node, replicas, sync, type Replica } from "../graph/graph.test-support.ts";
import { rawTagValues } from "./fold.ts";
import { hasValidTemplate } from "./roles.ts";
import { supertags, tag } from "./tags.test-support.ts";

const base = () => replicas([{ name: "I" }, { name: "T1" }, { name: "T2" }]);
const tagNodes = (values: ReturnType<typeof rawTagValues>) => values.map((value) => value.node);

test("concurrent first Add tag on two replicas keeps both tags, smallest metanode first", () => {
  const [a, b] = base();
  supertags(a!, "T1", "T2");
  sync(a!, b!);
  tag(b!, "I", ["T2"], "M2");
  tag(a!, "I", ["T1"], "M1");
  sync(a!, b!);

  for (const r of [a!, b!]) {
    deepStrictEqual(tagNodes(rawTagValues(r, id("I"))), [id("T1"), id("T2")]);
    strictEqual(hasValidTemplate(r, id("I")), true);
  }
});

test("an empty first application is replaced by another replica's tag in the fold", () => {
  const [a, b] = base();
  supertags(a!, "T2");
  sync(a!, b!);
  command(
    a!,
    [
      child("M1", "I", { listed: false, kind: "metanode" }),
      child("A1", "M1", { kind: "tuple", tupleDefinitionId: id("tags") }),
      child("E", "A1"),
    ],
    () => {},
    [{ host: id("I"), relation: { type: "meta", target: id("M1") } }],
  );
  tag(b!, "I", ["T2"], "M2");
  sync(a!, b!);

  deepStrictEqual(tagNodes(rawTagValues(a!, id("I"))), [id("T2")]);
  strictEqual(hasValidTemplate(a!, id("I")), true);
});

test("one tag in two candidates reads once with both provenances, and an undone candidate drops out", () => {
  const [a, b] = base();
  supertags(a!, "T1", "T2");
  sync(a!, b!);
  tag(a!, "I", ["T1"], "M1");
  tag(b!, "I", ["T1", "T2"], "M2");
  sync(a!, b!);

  const values = rawTagValues(a!, id("I"));
  deepStrictEqual(tagNodes(values), [id("T1"), id("T2")]);
  deepStrictEqual(
    values[0]!.provenance.map((p) => p.application),
    [id("M1:tags"), id("M2:tags")],
  );

  a!.undo.undo();
  sync(a!, b!);
  deepStrictEqual(
    rawTagValues(b!, id("I")).map((value) => [value.node, value.provenance.map((p) => p.application)]),
    [
      [id("T1"), [id("M2:tags")]],
      [id("T2"), [id("M2:tags")]],
    ],
  );
});

/** An application `app` in a new metanode `meta` of I, holding owned values (`owned`) and references. */
function application(r: Replica, meta: string, app: string, values: { name: string; owned?: boolean }[]): void {
  command(
    r,
    [
      child(meta, "I", { listed: false, kind: "metanode" }),
      child(app, meta, { kind: "tuple", tupleDefinitionId: id("tags") }),
      ...values.filter((value) => value.owned).map((value) => child(value.name, app)),
    ],
    () =>
      values.forEach((value, index) => {
        if (!value.owned) {
          createLeaf(node(r, app), index, id(value.name));
        }
      }),
    [{ host: id("I"), relation: { type: "meta", target: id(meta) } }],
  );
}

const read = (r: Replica) => ({
  values: rawTagValues(r, id("I")).map((value) => [value.node, value.provenance.map((p) => p.application)]),
  gate: hasValidTemplate(r, id("I")),
});

test("a first application with no values is still the seed, so a later empty value is replaced", () => {
  const [a, b] = base();
  supertags(a!, "T1");
  sync(a!, b!);
  application(a!, "M1", "A1", []);
  application(b!, "M2", "A2", [{ name: "E", owned: true }, { name: "T1" }]);
  sync(a!, b!);
  deepStrictEqual(read(a!), { values: [[id("T1"), [id("A2")]]], gate: true });
});

test("an empty first value is replaced before a repeated reference merges", () => {
  const [a, b] = base();
  supertags(a!, "T1");
  sync(a!, b!);
  application(a!, "M1", "A1", [{ name: "E", owned: true }, { name: "T1" }]);
  application(b!, "M2", "A2", [{ name: "T1" }]);
  sync(a!, b!);
  deepStrictEqual(read(a!), { values: [[id("T1"), [id("A1"), id("A2")]]], gate: true });
});
