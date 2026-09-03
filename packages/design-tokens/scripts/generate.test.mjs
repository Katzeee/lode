import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { themeVariableGroups } from "../dist/index.js";

const css = await readFile(new URL("../dist/tokens.css", import.meta.url), "utf8");

test("an unset mode follows the system dark preference", () => {
  assert.match(css, /@media \(prefers-color-scheme: dark\)/u);
  assert.match(css, /:root:not\(\[data-mode\]\)/u);
  assert.match(css, /\[data-theme="slate"\]:not\(\[data-mode\]\)/u);
  assert.doesNotMatch(css, /:root:not\(\[data-mode="light"\]\)/u);
});

test("the generated variable reference covers every runtime theme variable", () => {
  const documented = themeVariableGroups.flatMap(({ variables }) => variables.map(({ name }) => name));
  const emitted = [...css.matchAll(/(--lode-[a-z\d-]+)\s*:/gu)].map((match) => match[1]);
  assert.deepEqual([...new Set(documented)].sort(), [...new Set(emitted)].sort());
  assert.equal(new Set(documented).size, documented.length);
});

test("every variable resolves for every built-in theme and mode", () => {
  for (const group of themeVariableGroups) {
    for (const variable of group.variables) {
      for (const theme of ["forest", "slate"]) {
        assert.notEqual(variable.values[theme].light, "", `${variable.name} has a ${theme} light value`);
        assert.notEqual(variable.values[theme].dark, "", `${variable.name} has a ${theme} dark value`);
      }
    }
  }
});
