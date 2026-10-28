// Purpose: Guards one-to-one association reads under concurrent records and the holder index across imports.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { deleteRelationRecords, relationRecords, writeRelation } from "../store/relations.ts";
import { writeSupport } from "../store/records.ts";
import {
  candidateHolders,
  effectiveHolder,
  effectivePair,
  liveHolderRecords,
  unadoptedRecords,
} from "./associations.ts";
import { command, id, node, replicas, sync, type Replica } from "./graph.test-support.ts";
import { Store } from "../store/store.ts";

const assoc = (subject: string, holder: string) => ({
  type: "assoc" as const,
  subject: id(subject),
  holder: id(holder),
});

function associate(r: Replica, host: string, subject: string, holder: string): void {
  command(r, [], (cmd) => {
    writeRelation(r.store, node(r, host), assoc(subject, holder), cmd);
    writeSupport(node(r, host), cmd);
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
      node(a!, "H"),
      relationRecords(node(a!, "H")).filter((record) => record.type === "assoc" && record.holder === id("K1")),
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
    writeRelation(r!.store, node(r!, "H1"), assoc("S", "K"), cmd);
    writeRelation(r!.store, node(r!, "H2"), assoc("S", "K"), cmd);
    writeSupport(node(r!, "H1"), cmd);
    writeSupport(node(r!, "H2"), cmd);
  });
  const hosts = (g: Replica) =>
    liveHolderRecords(g, id("K"))
      .map((record) => record.host)
      .sort();
  deepStrictEqual(hosts(r!), [id("H1"), id("H2")]);

  command(r!, [], () => deleteRelationRecords(r!.store, node(r!, "H1"), relationRecords(node(r!, "H1"))));
  deepStrictEqual(hosts(r!), [id("H2")]);
  strictEqual(effectiveHolder(r!, id("H2"), id("S")), id("K"));

  const rebuilt = { ...r!, store: new Store(r!.store.doc) };
  deepStrictEqual(hosts(rebuilt), [id("H2")]);
  strictEqual(effectiveHolder(rebuilt, id("H2"), id("S")), id("K"));
});

test("association reads agree in both directions before the command commits", () => {
  const [r] = replicas([{ name: "H" }, { name: "S" }, { name: "K" }]);
  command(r!, [], (cmd) => {
    writeRelation(r!.store, node(r!, "H"), assoc("S", "K"), cmd);
    writeSupport(node(r!, "H"), cmd);
    strictEqual(effectiveHolder(r!, id("H"), id("S")), id("K"), "added, uncommitted");
  });
  strictEqual(effectiveHolder(r!, id("H"), id("S")), id("K"), "added, committed");

  command(r!, [], () => {
    deleteRelationRecords(r!.store, node(r!, "H"), relationRecords(node(r!, "H")));
    strictEqual(effectiveHolder(r!, id("H"), id("S")), undefined, "removed, uncommitted");
    strictEqual(liveHolderRecords(r!, id("K")).length, 0);
  });
  strictEqual(effectiveHolder(r!, id("H"), id("S")), undefined, "removed, committed");

  r!.undo.undo();
  strictEqual(effectiveHolder(r!, id("H"), id("S")), id("K"), "undo re-reads the host");
});
