import assert from "node:assert/strict";
import { designSystemTest } from "./support/browser.mjs";

async function navigate(page, hash) {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, hash);
}
const editorAt = (page, key) => page.locator(`[data-item-key="${key}"] [data-ui="outline-editor"]:focus`);

designSystemTest("Enter hands the first typed character directly to the newly mounted name region", async (page) => {
  await navigate(page, "#/node-editor-immediate-insertion");
  await page.locator('[data-item-key="same"] [data-ui="outline-row-text"]').click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second table row");
  await editorAt(page, "created").waitFor();
  assert.deepEqual(JSON.parse(await page.getByLabel("Name contents").textContent()), {
    same: [{ type: "text", text: "Same row" }],
    created: [{ type: "text", text: "Second table row" }],
  });
});

for (const existing of [false, true]) {
  designSystemTest(
    `Created appearance receives focus when its region ${existing ? "publishes new keys" : "mounts later"}`,
    async (page) => {
      await navigate(page, `#/node-editor-late-region${existing ? "-existing" : ""}`);
      await page.getByRole("button", { name: "Create node", exact: true }).click();
      assert.equal(await page.locator('[data-item-key="created"]').count(), 0);
      await page.getByRole("button", { name: "Reveal created region" }).click();
      await editorAt(page, "created").waitFor();
      await page.keyboard.type("New content");
      assert.equal(await editorAt(page, "created").textContent(), "New content");
    },
  );
}

designSystemTest("A delayed appearance does not steal focus after another target is selected", async (page) => {
  await navigate(page, "#/node-editor-late-region");
  await page.getByRole("button", { name: "Create node", exact: true }).click();
  await page.locator('[data-ui="outline-title"]').click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ongoing");
  await page.getByRole("button", { name: "Reveal created region" }).click();
  await editorAt(page, "heading").waitFor();
  assert.equal(await editorAt(page, "heading").textContent(), "Document ongoing");
  assert.equal(
    await editorAt(page, "heading").evaluate((element) => element.editor.state.selection.from - 1),
    "Document ongoing".length,
  );
  assert.equal(await editorAt(page, "created").count(), 0);
});

designSystemTest(
  "An embedded field region owns clipboard and structural keys within a selected parent outline",
  async (page) => {
    await navigate(page, "#/node-editor-nested-region");
    await page.getByRole("tree", { name: "Field values", exact: true }).waitFor();
    assert.equal(await page.locator('[data-item-key="hidden-child"]').count(), 0);
    await page.locator('[data-item-key="value-b"] [data-ui="outline-row-text"]').click();
    await page.keyboard.press("End");
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Control+z");
    assert.deepEqual(JSON.parse(await page.getByLabel("Region calls").textContent()), {
      "cell-copy": 1,
      "cell-paste": 1,
      "cell-move": 1,
      "cell-undo": 1,
    });
    assert.equal(await page.getByLabel("Move target").textContent(), "value-a");
    await editorAt(page, "value-b").waitFor();
  },
);
