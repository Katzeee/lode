// Purpose: Builds tagged nodes for tag-read tests: named supertags and hosts with tag applications.

import { insertListing } from "../store/listings.ts";
import { writeSupport } from "../store/records.ts";
import { child, command, id, node, type Replica } from "../graph/graph.test-support.ts";

/** Names `names` in one command. */
export function name(r: Replica, ...names: string[]): void {
  command(r, [], (cmd) => {
    for (const each of names) {
      r.store.name(id(each)).insert(0, each);
      writeSupport(node(r, each), cmd);
    }
  });
}

/**
 * Gives `host` a new metanode `<meta>` and application `<meta>:tags` holding references to `values`, in
 * one command, as a first Add tag creates them. `meta` defaults to `<host>:meta`.
 */
export function tag(r: Replica, host: string, values: string[], meta = `${host}:meta`): void {
  const application = `${meta}:tags`;
  command(
    r,
    [
      child(meta, host, { listed: false, kind: "metanode" }),
      child(application, meta, { kind: "tuple", tupleDefinitionId: id("tags") }),
    ],
    () => values.forEach((value, index) => insertListing(r.store, id(application), id(value), index)),
    [{ host: id(host), relation: { type: "meta", target: id(meta) } }],
  );
}

/** Makes each of `names` a named supertag. */
export function supertags(r: Replica, ...names: string[]): void {
  name(r, ...names);
  for (const each of names) {
    tag(r, each, ["supertag"]);
  }
}
