import assert from "node:assert/strict";
import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

const key = (path) => `outline-item:${encodeURIComponent(path)}`;
const row = (page, path) => page.locator(`[data-ui="outline-row"][data-item-key="${key(path)}"]`);
const selected = (page) => page.locator('[data-ui="outline-row"][aria-selected="true"]');
async function edit(page, path, offset = 0) {
  await row(page, path).locator('[data-ui="outline-row-text"]').click();
  const editor = page.locator('[data-ui="outline-editor"]:focus');
  await editor.waitFor();
  await editor.evaluate((element, position) => element.editor.commands.setTextSelection(position + 1), offset);
  return page.locator('[data-ui="outline-editor"]');
}

designSystemTest("Plain node clicks place a text caret without selecting a node", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const original = row(page, "inbox/local-first-original");
  await original.click();
  await original.locator('[data-ui="outline-editor"]:focus').waitFor();
  assert.equal(await selected(page).count(), 0);
  assert.equal(await page.getByRole("toolbar").count(), 0);
  assert.equal(await original.evaluate((element) => getComputedStyle(element).boxShadow), "none");
  await row(page, "inbox/crdt-survey").click();
  await row(page, "inbox/crdt-survey").locator('[data-ui="outline-editor"]:focus').waitFor();
  assert.equal(await selected(page).count(), 0);
});

designSystemTest("Escape toggles explicit node selection while preserving the live text editor", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const editor = await edit(page, "projects/home-lab", 4);
  await page.keyboard.press("Escape");
  assert.equal(await selected(page).count(), 1);
  assert.equal(await page.getByRole("toolbar").count(), 1);
  assert.equal(await editor.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press("Escape");
  assert.equal(await selected(page).count(), 0);
  await page.keyboard.press("Escape");
  await page.keyboard.type("!");
  assert.equal(await editor.textContent(), "Home! lab notes #{project}");
  assert.equal(await selected(page).count(), 0);
});

designSystemTest("Ctrl clicking nodes selects independently from the text caret", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const editor = await edit(page, "projects/home-lab", 4);
  await row(page, "inbox/local-first-original").click({ modifiers: ["Control"] });
  await row(page, "inbox/crdt-survey").click({ modifiers: ["Control"] });
  assert.equal(await selected(page).count(), 2);
  assert.equal(await editor.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.type("!");
  assert.equal(await editor.textContent(), "Home! lab notes #{project}");
  assert.equal(await selected(page).count(), 0);
});

designSystemTest("Shift arrows enter and extend node selection before ordinary typing resumes", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await edit(page, "inbox/local-first-original", 3);
  await page.keyboard.press("Shift+ArrowDown");
  assert.equal(await selected(page).count(), 1);
  await page.keyboard.press("Shift+ArrowDown");
  await row(page, "inbox/crdt-survey").locator('[data-ui="outline-editor"]:focus').waitFor();
  assert.equal(await selected(page).count(), 2);
  await page.keyboard.type("!");
  assert.equal(await page.locator('[data-ui="outline-editor"]').textContent(), "!CRDT ordering survey");
  assert.equal(await selected(page).count(), 0);
});

designSystemTest("Selected nodes delete as nodes and leave a text caret in the following row", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await edit(page, "inbox/local-first-original", 3);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");
  assert.equal(await row(page, "inbox/local-first-original").count(), 0);
  await row(page, "inbox/crdt-survey").locator('[data-ui="outline-editor"]:focus').waitFor();
  await page.keyboard.type("!");
  assert.equal(await page.locator('[data-ui="outline-editor"]').textContent(), "!CRDT ordering survey");
});

designSystemTest("A double click on a resting node selects a word for replacement", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const text = row(page, "inbox/crdt-survey").locator('[data-ui="outline-inline-content"]');
  await text.scrollIntoViewIfNeeded();
  const box = await text.boundingBox();
  assert.ok(box);
  await page.mouse.dblclick(box.x + 12, box.y + box.height / 2);
  await page.waitForFunction(() => window.getSelection()?.toString() === "CRDT");
  assert.equal(await selected(page).count(), 0);
  await page.keyboard.type("New");
  assert.equal(await page.locator('[data-ui="outline-editor"]').textContent(), "New ordering survey");
});

designSystemTest("Dragging across resting source text selects characters without selecting nodes", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const text = row(page, "inbox/crdt-survey").locator('[data-ui="outline-inline-content"]');
  await text.scrollIntoViewIfNeeded();
  const points = await text.evaluate((element) => {
    const node = element.querySelector("[data-source-start]").firstChild;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 4);
    const rect = range.getBoundingClientRect();
    return { from: rect.left + 0.1, to: rect.right - 0.1, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(points.from, points.y);
  await page.mouse.down();
  await page.mouse.move(points.to, points.y, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), "CRDT");
  assert.equal(await selected(page).count(), 0);
  await page.keyboard.type("New");
  assert.equal(await page.locator('[data-ui="outline-editor"]').textContent(), "New ordering survey");
});

designSystemTest("Dragging across rows creates explicit node selection and clicking text clears it", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const source = row(page, "inbox/crdt-survey");
  const target = row(page, "inbox/quick-capture");
  await target.scrollIntoViewIfNeeded();
  const from = await source.locator('[data-ui="outline-row-text"]').boundingBox();
  const to = await target.locator('[data-ui="outline-row-text"]').boundingBox();
  assert.ok(from && to);
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.equal(await selected(page).count(), 2);
  await source.locator('[data-ui="outline-row-text"]').click();
  assert.equal(await selected(page).count(), 0);
  assert.equal(await page.locator('[data-ui="outline-editor"]:focus').count(), 1);
});
