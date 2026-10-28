// Purpose: Guards the tag read layers on mixed raw values: the content gate reads the first tag only, badges read every named supertag.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { id, replicas } from "../graph/graph.test-support.ts";
import { tagBadges } from "./badges.ts";
import { hasValidTemplate, isFieldDefinition } from "./roles.ts";
import { allTemplates } from "./sources.ts";
import { template, templates } from "./templates.ts";
import { name, supertags, tag } from "./tags.test-support.ts";

// The audit captures `live/mixed-roleless` and `live/mixed-unnamed`: A has lost its supertag role but
// keeps its name; then B's name is cleared.
test("a roleless first tag closes the content gate; a roleless later tag only loses its badge", () => {
  const [r] = replicas([{ name: "A" }, { name: "B" }, { name: "X" }, { name: "Y" }]);
  name(r!, "A");
  supertags(r!, "B");
  tag(r!, "X", ["A", "B"]);
  tag(r!, "Y", ["B", "A"]);

  deepStrictEqual([hasValidTemplate(r!, id("X")), hasValidTemplate(r!, id("Y"))], [false, true]);
  deepStrictEqual([tagBadges(r!, id("X")), tagBadges(r!, id("Y"))], [[id("B")], [id("B")]]);
  deepStrictEqual(allTemplates(r!, id("Y")), [id("B"), id("A")], "both tags still contribute sources");
});

test("an unnamed supertag first closes the gate and shows no badge", () => {
  const [r] = replicas([{ name: "A" }, { name: "B" }, { name: "Y" }]);
  name(r!, "A");
  tag(r!, "B", ["supertag"]);
  tag(r!, "Y", ["B", "A"]);

  strictEqual(hasValidTemplate(r!, id("Y")), false);
  deepStrictEqual(tagBadges(r!, id("Y")), []);
});

test("the field-definition role reads the first raw value only", () => {
  const [r] = replicas([{ name: "T" }, { name: "F1" }, { name: "F2" }]);
  supertags(r!, "T");
  tag(r!, "F1", ["fieldDefinition", "T"]);
  tag(r!, "F2", ["T", "fieldDefinition"]);
  deepStrictEqual([isFieldDefinition(r!, id("F1")), isFieldDefinition(r!, id("F2"))], [true, false]);
});

test("a metanode's template is the metanode template, which opens its content gate", () => {
  const [g] = replicas([{ name: "metaTemplate" }, { name: "T" }, { name: "I" }]);
  supertags(g!, "metaTemplate", "T");
  tag(g!, "I", ["T"]);
  const metanode = id("I:meta");
  deepStrictEqual([templates(g!, metanode), template(g!, metanode)], [[id("metaTemplate")], id("metaTemplate")]);
  strictEqual(hasValidTemplate(g!, metanode), true);
  deepStrictEqual(allTemplates(g!, metanode), [id("metaTemplate")]);
  deepStrictEqual(templates(g!, id("I")), [id("T")], "the host reads its own tags");
});
