// Purpose: Guards the merged template list: field precedence and position across tags, name and source matching, and the content gate.

import { deepStrictEqual } from "node:assert/strict";
import { test } from "node:test";
import { nameOf } from "../store/records.ts";
import { writeMention } from "../store/text.ts";
import { child, command, id, node, replicas } from "../graph/graph.test-support.ts";
import { name, tag } from "../tags/tags.test-support.ts";
import { addressKey } from "./address.ts";
import { mergedList } from "./merged.ts";
import { outlineLines } from "./outline.ts";
import { children, field, nameAs, template } from "./projection.test-support.ts";

const lineKeys = (lines: { node: Parameters<typeof addressKey>[0] }[]) => lines.map((line) => addressKey(line.node));

test("a field two tags supply keeps the later tag's tuple at the earlier tag's position", () => {
  const [r] = replicas([{ name: "I" }, { name: "F" }]);
  template(r!, "A", "x");
  field(r!, "A", "Ta", "F", "va");
  template(r!, "B", "y");
  field(r!, "B", "Tb", "F", "vb");
  tag(r!, "I", ["A", "B"]);

  deepStrictEqual(
    mergedList(r!, id("I"), { kind: "outline" }).map((entry) => entry.template),
    ["x", "Tb", "y"].map(id),
  );
});

test("children with equal names in two tags show once, from the later tag", () => {
  const [r] = replicas([{ name: "I" }]);
  template(r!, "A");
  template(r!, "B");
  command(r!, [child("a-same", "A"), child("b-same", "B")]);
  nameAs(r!, "a-same", "same");
  nameAs(r!, "b-same", "same");
  tag(r!, "I", ["A", "B"]);

  deepStrictEqual(
    mergedList(r!, id("I"), { kind: "outline" }).map((entry) => entry.template),
    [id("b-same")],
  );
});

test("local children fill template children by source, then by name; initialization has no source match", () => {
  const [r] = replicas([{ name: "I" }]);
  template(r!, "A", "x", "y");
  tag(r!, "I", ["A"]);
  command(r!, [child("L1", "I", { sourceId: id("x") }), child("L2", "I")]);
  name(r!, "L1");
  nameAs(r!, "L2", "y");
  children(r!, "I", "rest");

  deepStrictEqual(lineKeys(outlineLines(r!, id("I"))), ["L1", "L2", "rest"].map(id));
  deepStrictEqual(
    mergedList(r!, id("I"), { kind: "initialization", materializeDefaults: true }).map((entry) => [
      entry.template,
      entry.filledBy,
    ]),
    [
      [id("x"), "projection"],
      [id("y"), "local"],
    ],
  );
});

test("a node whose first tag is not a named supertag shows only its own children", () => {
  const [r] = replicas([{ name: "I" }, { name: "Plain" }]);
  template(r!, "A", "x");
  name(r!, "Plain");
  tag(r!, "I", ["Plain", "A"]);
  children(r!, "I", "own");
  deepStrictEqual(lineKeys(outlineLines(r!, id("I"))), [id("own")]);
});

test("a plain local name equal to a field's definition id fills that field", () => {
  const [r] = replicas([{ name: "I" }, { name: "F" }]);
  template(r!, "A");
  field(r!, "A", "T", "F", "V");
  command(r!, [child("Local", "I")]);
  nameAs(r!, "Local", "F");
  tag(r!, "I", ["A"]);
  deepStrictEqual(mergedList(r!, id("I"), { kind: "outline" }), [
    { template: id("T"), node: id("Local"), filledBy: "local" },
  ]);
});

test("formatted text never matches literal text that spells the format; equal rich text matches", () => {
  const [r] = replicas([{ name: "I" }]);
  template(r!, "A");
  command(r!, [child("bold", "A"), child("literal", "I"), child("alsoBold", "A"), child("sameBold", "I")], () => {
    for (const [each, text] of [
      ["bold", "x"],
      ["literal", "<bold>x</>"],
      ["alsoBold", "y"],
      ["sameBold", "y"],
    ]) {
      nameOf(node(r!, each!)).insert(0, text!);
    }
    for (const each of ["bold", "alsoBold", "sameBold"]) {
      nameOf(node(r!, each)).mark({ start: 0, end: 1 }, "bold", true);
    }
  });
  tag(r!, "I", ["A"]);

  deepStrictEqual(
    mergedList(r!, id("I"), { kind: "outline" }).map((entry) => [entry.template, entry.filledBy]),
    [
      [id("bold"), "projection"],
      [id("alsoBold"), "local"],
    ],
  );
});

test("each adjacent inline mention or date is its own position in a name", () => {
  const [r] = replicas([{ name: "I" }, { name: "X" }]);
  template(r!, "A");
  command(
    r!,
    [child("two", "A"), child("one", "I"), child("dates", "A"), child("date", "I"), child("twoToo", "I")],
    () => {
      for (const [each, count] of [
        ["two", 2],
        ["one", 1],
        ["twoToo", 2],
      ] as const) {
        for (let index = 0; index < count; index++) {
          writeMention(nameOf(node(r!, each)), index, id("X"));
        }
      }
      for (const [each, count] of [
        ["dates", 2],
        ["date", 1],
      ] as const) {
        nameOf(node(r!, each)).insert(0, "\uFFFC".repeat(count));
        nameOf(node(r!, each)).mark({ start: 0, end: count }, "date", "2026-10-28");
      }
    },
  );
  tag(r!, "I", ["A"]);

  deepStrictEqual(
    mergedList(r!, id("I"), { kind: "outline" }).map((entry) => [entry.template, entry.node]),
    [
      [id("two"), id("twoToo")],
      [id("dates"), { instance: id("I"), root: id("dates"), source: id("dates"), mode: "template" }],
    ],
  );
});
