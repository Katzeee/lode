import assert from "node:assert/strict";
import { designSystemTest } from "./support/browser.mjs";

async function openLifecycle(page, empty = false) {
  await page.evaluate(
    (hash) => {
      window.location.hash = hash;
    },
    `#/node-editor-lifecycle${empty ? "-empty" : ""}`,
  );
  await page.getByRole("tree", { name: "Lifecycle outline", exact: true }).waitFor();
}
const editorAt = (page, key) => page.locator(`[data-item-key="${key}"] [data-ui="outline-editor"]:focus`);

designSystemTest(
  "A delayed split handoff cannot blur-submit the source version consumed by the split",
  async (page) => {
    await openLifecycle(page);
    await page.locator('[data-item-key="source"] [data-ui="outline-row-text"]').click();
    await editorAt(page, "source").waitFor();
    await editorAt(page, "source").evaluate((element) => element.editor.commands.setTextSelection(7));
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Publish split" }).click();
    await editorAt(page, "created").waitFor();
    assert.equal(await editorAt(page, "created").textContent(), "Beta");
    assert.equal(
      await page.locator('[data-item-key="source"] [data-ui="outline-inline-content"]').textContent(),
      "Alpha ",
    );
    assert.deepEqual(JSON.parse(await page.getByLabel("Submitted contents").textContent()), [
      { key: "source", text: "Alpha Beta", reason: "operation" },
    ]);
    await page.keyboard.press("Backspace");
    await editorAt(page, "source").waitFor();
    assert.equal(await editorAt(page, "source").textContent(), "Alpha Beta");
  },
);

designSystemTest("Typing after a submitted operation remains eligible for a real blur commit", async (page) => {
  await openLifecycle(page);
  await page.locator('[data-item-key="source"] [data-ui="outline-row-text"]').click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("!");
  await page.getByRole("button", { name: "Outside focus" }).click();
  await page.locator('[data-ui="outline-editor"]').waitFor({ state: "detached" });
  assert.deepEqual(JSON.parse(await page.getByLabel("Submitted contents").textContent()), [
    { key: "source", text: "Alpha Beta", reason: "operation" },
    { key: "source", text: "Alpha Beta!", reason: "blur" },
  ]);
});

designSystemTest("Leaving an untouched empty placeholder still notifies the host to discard it", async (page) => {
  await openLifecycle(page, true);
  await page.locator('[data-item-key="empty"] [data-ui="outline-row-text"]').click();
  await editorAt(page, "empty").waitFor();
  await page.getByRole("button", { name: "Outside focus" }).click();
  await page.locator('[data-item-key="empty"]').waitFor({ state: "detached" });
  assert.deepEqual(JSON.parse(await page.getByLabel("Submitted contents").textContent()), [
    { key: "empty", text: "", reason: "blur" },
  ]);
});
