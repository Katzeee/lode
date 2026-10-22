import assert from "node:assert/strict";
import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

const key = (path) => `outline-item:${encodeURIComponent(path)}`;
const row = (page, path) => page.locator(`[data-ui="outline-row"][data-item-key="${key(path)}"]`);
const current = (page) => page.locator('[data-ui="outline-row"][data-editing="true"]');
const editor = (page) => page.locator('[data-ui="outline-editor"]');
async function edit(page, path, offset = 0) {
  await row(page, path).locator('[data-ui="outline-row-text"]').click();
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  await editor(page).evaluate((element, position) => element.editor.commands.setTextSelection(position + 1), offset);
}
async function paste(page, data) {
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    for (const [type, content] of Object.entries(data)) {
      transfer.setData(type, content);
    }
    document.activeElement.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
    );
  }, data);
}
async function copy(page, cut = false) {
  return page.evaluate((cut) => {
    const transfer = new DataTransfer();
    document.activeElement.dispatchEvent(
      new ClipboardEvent(cut ? "cut" : "copy", { bubbles: true, cancelable: true, clipboardData: transfer }),
    );
    return Object.fromEntries(transfer.types.map((type) => [type, transfer.getData(type)]));
  }, cut);
}

designSystemTest("Outline undo spans text editor sessions and restores the edited node", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await edit(page, "inbox/crdt-survey", "CRDT ordering survey".length);
  await page.keyboard.type(" draft");
  await edit(page, "projects/home-lab", 3);
  await page.keyboard.press("Control+z");
  await row(page, "inbox/crdt-survey").locator('[data-ui="outline-editor"]:focus').waitFor();
  assert.equal(await editor(page).textContent(), "CRDT ordering survey");
  await page.keyboard.press("Control+Shift+z");
  assert.equal(await row(page, "inbox/crdt-survey").textContent(), "CRDT ordering survey draft");
});

designSystemTest("Outline structural moves and insertion each undo as one edit", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await edit(page, "inbox/crdt-survey", "CRDT ordering survey".length);
  await page.keyboard.press("Enter");
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  const siblingKey = await current(page).getAttribute("data-item-key");
  await page.keyboard.type("Draft");
  await page.keyboard.press("Tab");
  await page.waitForFunction(
    (key) =>
      document.querySelector('[data-ui="outline-row"][data-editing="true"]')?.getAttribute("data-item-key") !== key,
    siblingKey,
  );
  await page.keyboard.press("Control+z");
  assert.equal(await current(page).getAttribute("data-item-key"), siblingKey);
  assert.equal(await editor(page).textContent(), "Draft");
  await page.keyboard.press("Control+z");
  assert.equal(await editor(page).textContent(), "");
  await page.keyboard.press("Control+z");
  assert.equal(await current(page).getAttribute("data-item-key"), key("inbox/crdt-survey"));
  assert.equal(await page.locator(`[data-item-key="${siblingKey}"]`).count(), 0);
});

designSystemTest("Forward delete merges the next leaf and undo restores both node identities", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await edit(page, "inbox/crdt-survey", 0);
  await page.keyboard.press("Shift+Enter");
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  await page.keyboard.type("Tail");
  const tailKey = await current(page).getAttribute("data-item-key");
  await edit(page, "inbox/crdt-survey", "CRDT ordering survey".length);
  await page.keyboard.press("Delete");
  assert.equal(await editor(page).textContent(), "CRDT ordering surveyTail");
  assert.equal(await page.locator(`[data-item-key="${tailKey}"]`).count(), 0);
  await page.keyboard.press("Control+z");
  assert.equal(await editor(page).textContent(), "CRDT ordering survey");
  assert.equal(await page.locator(`[data-item-key="${tailKey}"]`).textContent(), "Tail");
});

designSystemTest(
  "Multiline paste creates sibling nodes, preserves current text and undoes atomically",
  async (page) => {
    await navigateToCatalogPage(page, "components/outline");
    await edit(page, "inbox/crdt-survey", 2);
    await paste(page, { "text/plain": "First\nSecond" });
    await page.locator('[data-ui="outline-editor"]:focus').waitFor();
    assert.equal(await editor(page).textContent(), "Second");
    assert.equal(await row(page, "inbox/crdt-survey").textContent(), "CRDT ordering survey");
    assert.equal(await current(page).getAttribute("data-parent-key"), key("inbox"));
    await page.keyboard.press("Control+z");
    assert.equal(await page.locator('[data-ui="outline-row"]', { hasText: /^First$/ }).count(), 0);
    assert.equal(await current(page).getAttribute("data-item-key"), key("inbox/crdt-survey"));
  },
);

designSystemTest("Copied nodes paste as shared inline references and as reference occurrences", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await edit(page, "inbox/crdt-survey", 3);
  await page.keyboard.press("Escape");
  const clipboard = await copy(page);
  assert.equal(clipboard["text/plain"], "CRDT ordering survey");
  await edit(page, "projects/home-lab", 4);
  await paste(page, clipboard);
  assert.equal(await editor(page).textContent(), "Home@{CRDT ordering survey} lab notes #{project}");
  await edit(page, "inbox/quick-capture", 0);
  await paste(page, clipboard);
  assert.equal(
    await current(page).getAttribute("data-item-key"),
    key("inbox/crdt-survey"),
    "pasting into the same parent reuses its existing occurrence",
  );
  await row(page, "projects/home-lab")
    .getByRole("button", { name: /^Expand/ })
    .click();
  await row(page, "projects/home-lab").locator("..").locator('[data-ui="outline-empty-child-placeholder"]').click();
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  await paste(page, clipboard);
  assert.equal(await current(page).locator('[data-appearance="reference"]').count(), 1);
  assert.equal(await editor(page).textContent(), "CRDT ordering survey");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Renamed survey");
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  assert.equal(await row(page, "inbox/crdt-survey").textContent(), "Renamed survey");
  assert.equal(
    await row(page, "projects/home-lab").locator('[data-ui="outline-reference"]').textContent(),
    "Renamed survey",
  );
});

designSystemTest("Deleting all nodes leaves an editable empty outline and remains undoable", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const count = await page.locator('[data-ui="outline-row"]').count();
  await edit(page, "inbox/crdt-survey", 2);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  assert.equal(await page.locator('[data-ui="outline-row"]').count(), 0);
  assert.equal(await page.getByRole("button", { name: "Create node", exact: true }).count(), 1);
  await page.keyboard.type("x");
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  assert.equal(await editor(page).textContent(), "x");
  await page.keyboard.press("Control+z");
  assert.equal(await page.locator('[data-ui="outline-row"]').count(), 0);
  await paste(page, { "text/plain": "Pasted into empty outline" });
  assert.equal(await editor(page).textContent(), "Pasted into empty outline");
  await page.keyboard.press("Control+z");
  assert.equal(await page.locator('[data-ui="outline-row"]').count(), 0);
  await page.keyboard.press("Control+z");
  assert.equal(await page.locator('[data-ui="outline-row"]').count(), count);
});

designSystemTest("Formatting has its own undo boundary after text input", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await edit(page, "inbox/quick-capture", 0);
  await page.keyboard.type("Word");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+b");
  assert.equal(await editor(page).textContent(), "**Word**");
  await page.keyboard.press("Control+z");
  assert.equal(await editor(page).textContent(), "Word");
  await page.keyboard.press("Control+z");
  assert.equal(await editor(page).textContent(), "");
});

designSystemTest("Duplicating a node creates independent content and is undoable", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await edit(page, "inbox/crdt-survey", 3);
  await page.keyboard.press("Alt+Shift+d");
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  const duplicate = await current(page).getAttribute("data-item-key");
  assert.notEqual(duplicate, key("inbox/crdt-survey"));
  await page.keyboard.type(" copy");
  assert.equal(await row(page, "inbox/crdt-survey").textContent(), "CRDT ordering survey");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  assert.equal(await page.locator(`[data-item-key="${duplicate}"]`).count(), 0);
});

designSystemTest("Cutting a node transfers its identity to the new parent", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await edit(page, "inbox/crdt-survey", 3);
  await page.keyboard.press("Escape");
  const clipboard = await copy(page, true);
  assert.equal(await row(page, "inbox/crdt-survey").count(), 0);
  await page.getByRole("button", { name: "Expand Home lab notes", exact: true }).click();
  await page.getByRole("button", { name: "Create child under Home lab notes", exact: true }).click();
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  await paste(page, clipboard);
  assert.equal(await editor(page).textContent(), "CRDT ordering survey");
  assert.equal(await current(page).getAttribute("data-parent-key"), key("projects/home-lab"));
  assert.equal(await current(page).locator('[data-appearance="reference"]').count(), 0);
});

designSystemTest("Choosing a field continues directly in its new value editor", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await edit(page, "inbox/quick-capture", 0);
  await page.keyboard.type(">");
  await page.getByRole("listbox", { name: "Fields" }).getByRole("option", { name: "Notes" }).click();
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  await page.keyboard.type("Field value");
  assert.equal(await editor(page).textContent(), "Field value");
  assert.equal(await current(page).getAttribute("data-parent-key"), key("inbox/quick-capture"));
  assert.equal(await page.locator('[aria-selected="true"][data-ui="outline-row"]').count(), 0);
});
