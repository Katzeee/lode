// Purpose: Guards one-to-one association reads under concurrent records, the holder index across imports, and records naming a subject with no incarnation yet.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { deleteRelationRecords, relationRecords, writeRelation } from "../store/relations.ts";
import { writeSupport } from "../store/records.ts";
import {
  associatedSubjects,
  candidateHolders,
  effectiveHolder,
  effectivePair,
  liveHolderRecords,
  unadoptedRecords,
} from "./associations.ts";
import { command, id, replicas, type Replica } from "./graph.test-support.ts";
import { sync } from "../store/replicas.test-support.ts";
import { Store } from "../store/store.ts";

const assoc = (subject: string, holder: string) => ({
  type: "assoc" as const,
  subject: id(subject),
  holder: id(holder),
});

function associate(r: Replica, host: string, subject: string, holder: string): void {
  command(r, [], (cmd) => {
    writeRelation(r.store, id(host), assoc(subject, holder), cmd);
    writeSupport(r.store, id(host), cmd);
  });
}

test("one holder raced into two pairs serves only its smallest pair; the other record stays unadopted", () => {
  const [a, b] = replicas([{ name: "H1" }, { name: "H2" }, { name: "S" }, { name: "K", parent: "H1", listed: false }]);
  associate(a!, "H1", "S", "K");
  associate(b!, "H2", "S", "K");
  sync(a!, b!);

  for (const r of [a!, b!]) {
    deepStrictEqual(effectivePair(r, id("K")), { host: id("H1"), subject: id("S") });
    strictEqual(effectiveHolder(r, id("H1"), id("S")), id("K"));
    strictEqual(effectiveHolder(r, id("H2"), id("S")), undefined);
    deepStrictEqual(
      unadoptedRecords(r, id("H2"), id("S")).map((record) => record.holder),
      [id("K")],
    );
    strictEqual(liveHolderRecords(r, id("K")).length, 2, "the index found the imported record");
  }
});

test("two holders for one pair: the smallest is effective, and the next takes over when its record goes", () => {
  const [a, b] = replicas([{ name: "H" }, { name: "S" }, { name: "K1" }, { name: "K2" }]);
  associate(a!, "H", "S", "K2");
  associate(b!, "H", "S", "K1");
  sync(a!, b!);
  deepStrictEqual(candidateHolders(a!, id("H"), id("S")), [id("K1"), id("K2")]);
  strictEqual(effectiveHolder(a!, id("H"), id("S")), id("K1"));

  command(a!, [], () =>
    deleteRelationRecords(
      a!.store,
      id("H"),
      relationRecords(a!.store, id("H")).filter((record) => record.type === "assoc" && record.holder === id("K1")),
    ),
  );
  sync(a!, b!);
  for (const r of [a!, b!]) {
    strictEqual(effectiveHolder(r, id("H"), id("S")), id("K2"));
    strictEqual(liveHolderRecords(r, id("K1")).length, 0, "the index dropped the deleted record");
  }
});

test("records with the same key on two hosts are indexed apart, and a rebuilt index reads the same", () => {
  const [r] = replicas([{ name: "H1" }, { name: "H2" }, { name: "S" }, { name: "K" }]);
  command(r!, [], (cmd) => {
    writeRelation(r!.store, id("H1"), assoc("S", "K"), cmd);
    writeRelation(r!.store, id("H2"), assoc("S", "K"), cmd);
    writeSupport(r!.store, id("H1"), cmd);
    writeSupport(r!.store, id("H2"), cmd);
  });
  const hosts = (g: Replica) =>
    liveHolderRecords(g, id("K"))
      .map((record) => record.host)
      .sort();
  deepStrictEqual(hosts(r!), [id("H1"), id("H2")]);

  command(r!, [], () => deleteRelationRecords(r!.store, id("H1"), relationRecords(r!.store, id("H1"))));
  deepStrictEqual(hosts(r!), [id("H2")]);
  strictEqual(effectiveHolder(r!, id("H2"), id("S")), id("K"));

  const rebuilt = { ...r!, store: new Store(r!.store.doc) };
  deepStrictEqual(hosts(rebuilt), [id("H2")]);
  strictEqual(effectiveHolder(rebuilt, id("H2"), id("S")), id("K"));
});

test("association reads agree in both directions before the command commits", () => {
  const [r] = replicas([{ name: "H" }, { name: "S" }, { name: "K" }]);
  command(r!, [], (cmd) => {
    writeRelation(r!.store, id("H"), assoc("S", "K"), cmd);
    writeSupport(r!.store, id("H"), cmd);
    strictEqual(effectiveHolder(r!, id("H"), id("S")), id("K"), "added, uncommitted");
  });
  strictEqual(effectiveHolder(r!, id("H"), id("S")), id("K"), "added, committed");

  command(r!, [], () => {
    deleteRelationRecords(r!.store, id("H"), relationRecords(r!.store, id("H")));
    strictEqual(effectiveHolder(r!, id("H"), id("S")), undefined, "removed, uncommitted");
    strictEqual(liveHolderRecords(r!, id("K")).length, 0);
  });
  strictEqual(effectiveHolder(r!, id("H"), id("S")), undefined, "removed, committed");

  r!.undo.undo();
  strictEqual(effectiveHolder(r!, id("H"), id("S")), id("K"), "undo re-reads the host");
});

test("a record naming a subject not yet allocated is live, so its holder is found and enumerated", () => {
  const [r] = replicas([{ name: "H" }, { name: "K", parent: "H", listed: false }]);
  associate(r!, "H", "~(I,S)", "K");
  strictEqual(r!.store.has(id("~(I,S)")), false);
  deepStrictEqual(
    [effectiveHolder(r!, id("H"), id("~(I,S)")), associatedSubjects(r!, id("H"))],
    [id("K"), [id("~(I,S)")]],
  );
});
