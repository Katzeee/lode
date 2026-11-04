// Purpose: Guards the owner and listing guards: the root stays unowned, Trash and Schema stay under the root, nothing ordinary moves under a definition or is listed there, and a system tuple's listing is never changed, all refused without writes, while a reference to a definition elsewhere still moves.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { id } from "../graph/graph.test-support.ts";
import { listedNodes, lists } from "../graph/occurrences.ts";
import { ownerOf } from "../graph/presence.ts";
import { run } from "../history/history.test-support.ts";
import { applicationId, metanodeId } from "../store/derived-id.ts";
import { addChild, removeChild } from "./listing.ts";
import { workspace } from "./operations.test-support.ts";
import { moveChildTo, setOwner } from "./owner.ts";

const N = id("N");
const M = id("M");
const H = id("H");
const P = id("P");
const home = id("home");
const root = id("root");
const supertag = id("supertag");

test("the root, Trash and Schema keep their owners, and the root keeps listing Trash and Schema", () => {
  const [r] = workspace([{ name: "H", parent: "home" }]);
  const version = r!.store.doc.oplogVersion().toJSON();
  const outcomes = run(r!, (writer) => [
    setOwner(writer, root, H),
    setOwner(writer, id("trash"), H),
    setOwner(writer, id("schema"), undefined),
    moveChildTo(writer, id("schema"), root, H),
    moveChildTo(writer, id("trash"), root, H),
  ]);
  run(r!, (writer) => removeChild(writer, root, id("schema")));
  deepStrictEqual(outcomes, [false, false, false, false, false]);
  deepStrictEqual(r!.store.doc.oplogVersion().toJSON(), version);
  deepStrictEqual(
    [ownerOf(r!, id("trash")), ownerOf(r!, id("schema")), lists(r!, root, id("trash")), lists(r!, root, id("schema"))],
    [root, root, true, true],
  );
});

test("nothing ordinary moves under a definition or is listed there, and the node can still move elsewhere", () => {
  const [r] = workspace([{ name: "N", parent: "home" }, { name: "M" }, { name: "P", parent: "home" }]);
  run(r!, (writer) => addChild(writer, P, N));
  const version = r!.store.doc.oplogVersion().toJSON();
  const outcomes = run(r!, (writer) => {
    addChild(writer, supertag, M);
    addChild(writer, supertag, N);
    return [setOwner(writer, N, supertag), moveChildTo(writer, N, home, supertag), moveChildTo(writer, N, P, supertag)];
  });
  deepStrictEqual([outcomes, r!.store.doc.oplogVersion().toJSON()], [[false, false, false], version]);
  deepStrictEqual(
    [ownerOf(r!, N), ownerOf(r!, M), lists(r!, supertag, M), lists(r!, supertag, N)],
    [home, undefined, false, false],
  );
  run(r!, (writer) => setOwner(writer, N, root));
  deepStrictEqual(ownerOf(r!, N), root);
});

for (const action of ["remove", "move"] as const) {
  test(`a system tuple's last value stays without a write when it is ${action === "remove" ? "removed" : "moved to Home"}`, () => {
    const [r] = workspace([]);
    const application = applicationId(metanodeId(supertag));
    const version = r!.store.doc.oplogVersion().toJSON();
    const ids = [...r!.store.ownership.ids()].sort();
    const outcome = run(r!, (writer) =>
      action === "remove"
        ? removeChild(writer, application, supertag)
        : moveChildTo(writer, supertag, application, home),
    );
    deepStrictEqual(
      [
        outcome,
        r!.store.doc.oplogVersion().toJSON(),
        [...r!.store.ownership.ids()].sort(),
        listedNodes(r!, application),
      ],
      [action === "remove" ? undefined : false, version, ids, [supertag]],
    );
  });
}

test("a reference to a definition under an ordinary parent still moves", () => {
  const [r] = workspace([{ name: "P", parent: "home" }]);
  run(r!, (writer) => addChild(writer, P, supertag));
  strictEqual(
    run(r!, (writer) => moveChildTo(writer, supertag, P, home)),
    true,
  );
  deepStrictEqual(
    [listedNodes(r!, P), listedNodes(r!, home).includes(supertag), ownerOf(r!, supertag)],
    [[], true, root],
  );
});
