// Purpose: Builds templates for projection tests: supertags with children, field tuples and tagged instances.

import { child, command, id, type Replica } from "../graph/graph.test-support.ts";
import { nameOf, writeSupport } from "../store/records.ts";
import { name, supertags } from "../tags/tags.test-support.ts";

/** Creates `names` as children listed by `parent`, each named after itself. */
export function children(r: Replica, parent: string, ...names: string[]): void {
  command(
    r,
    names.map((each) => child(each, parent)),
  );
  name(r, ...names);
}

/** A field tuple `tuple` under `parent` for definition `field`, with named owned values. */
export function field(r: Replica, parent: string, tuple: string, definition: string, ...values: string[]): void {
  command(r, [
    child(tuple, parent, { kind: "tuple", tupleDefinitionId: id(definition) }),
    ...values.map((v) => child(v, tuple)),
  ]);
  if (values.length > 0) {
    name(r, ...values);
  }
}

/** A new named supertag, ownerless, holding the given children. */
export function template(r: Replica, supertag: string, ...childNames: string[]): void {
  command(r, [{ id: id(supertag), listed: false }]);
  supertags(r, supertag);
  if (childNames.length > 0) {
    children(r, supertag, ...childNames);
  }
}

/** Gives `node` the name `text`, as a command. */
export function nameAs(r: Replica, node: string, text: string): void {
  command(r, [], (cmd) => {
    nameOf(r.store.node(id(node))).insert(0, text);
    writeSupport(r.store.node(id(node)), cmd);
  });
}
