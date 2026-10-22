import assert from "node:assert/strict";
import { designSystemTest } from "./support/browser.mjs";

async function openRegions(page, suffix = "") {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#/node-editor-regions${suffix}`);
  await page.getByRole("tree", { name: "First region", exact: true }).waitFor({ state: "attached" });
}

const editorAt = (page, key) => page.locator(`[data-item-key="${key}"] [data-ui="outline-editor"]:focus`);

designSystemTest("Node regions restore host history to the heading without overwriting its result", async (page) => {
  await openRegions(page);
  await page.locator('[data-ui="outline-title"]').click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.locator('[data-item-key="second"] [data-ui="outline-row-text"]').click();
  await page.keyboard.press("Control+z");
  await editorAt(page, "heading").waitFor();
  assert.equal(await editorAt(page, "heading").textContent(), "Document");
  assert.equal(await editorAt(page, "heading").evaluate((element) => element.editor.state.selection.from - 1), 2);
  assert.equal(await page.getByLabel("Stored heading").textContent(), '[{"type":"text","text":"Document"}]');
  assert.equal(await page.locator('[data-ui="outline-editor"]').count(), 1);
});

designSystemTest("Heading navigation enters an empty region without creating a node or skipping it", async (page) => {
  await openRegions(page, "-empty");
  await page.locator('[data-ui="outline-title"]').click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page
      .getByRole("tree", { name: "First region", exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  assert.equal(await page.getByLabel("Created nodes").textContent(), "0");
  assert.equal(await page.getByLabel("Heading fallbacks").textContent(), "0");
  await page.keyboard.press("ArrowUp");
  await editorAt(page, "heading").waitFor();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("x");
  await editorAt(page, "first").waitFor();
  assert.equal(await editorAt(page, "first").textContent(), "x");
  assert.equal(await page.getByLabel("Created nodes").textContent(), "1");
});

designSystemTest("Keyboard navigation between regions clears the previous subtree selection", async (page) => {
  await openRegions(page);
  await page.locator('[data-item-key="first"] [data-ui="outline-row-text"]').click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('[data-item-key="first"][data-selected="true"]').count(), 1);
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await editorAt(page, "second").waitFor();
  assert.equal(await page.locator('[data-selected="true"]').count(), 0);
});

designSystemTest("A delayed history response does not steal editing focus from another region", async (page) => {
  await openRegions(page, "-delayed");
  await page.locator('[data-item-key="second"] [data-ui="outline-row-text"]').click();
  await page.keyboard.press("Control+z");
  await page.locator('[data-ui="outline-title"]').click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ongoing");
  await page.getByRole("button", { name: "Release history" }).click();
  await editorAt(page, "heading").waitFor();
  assert.equal(
    await editorAt(page, "heading").evaluate((element) => element.editor.state.selection.from - 1),
    "Document ongoing".length,
  );
});
