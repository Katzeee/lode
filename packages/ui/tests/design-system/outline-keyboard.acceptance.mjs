import assert from "node:assert/strict";

import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

const key = (path) => `outline-item:${encodeURIComponent(path)}`;
const rowAt = (page, path) => page.locator(`[data-item-key="${key(path)}"]`);
const activeRow = (page) => page.locator('[data-ui="outline-row"][data-editing="true"]');
const selection = (editor) =>
  editor.evaluate((element) => ({
    from: element.editor.state.selection.from - 1,
    to: element.editor.state.selection.to - 1,
  }));
async function editRow(page, path, from, to = from) {
  await rowAt(page, path).locator('[data-ui="outline-row-text"]').click();
  const editor = page.locator('[data-ui="outline-editor"]');
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  await editor.evaluate(
    (element, range) =>
      element.editor.commands.setTextSelection({
        from: range.from + 1,
        to: range.to + 1,
      }),
    { from, to },
  );
  return editor;
}

designSystemTest("Tana Enter placement respects expansion, forced siblings and the start boundary", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const editor = await editRow(page, "projects", "Projects".length);
  await editor.press("Enter");
  assert.equal(await activeRow(page).getAttribute("data-parent-key"), key("projects"));
  assert.equal(await activeRow(page).getAttribute("aria-posinset"), "1");
  assert.equal(await editor.textContent(), "");
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editRow(page, "projects", "Projects".length);
  await editor.press("Control+ArrowUp");
  await editor.press("Enter");
  assert.equal(await activeRow(page).getAttribute("data-parent-key"), null);
  assert.equal(await rowAt(page, "projects").getAttribute("aria-expanded"), "false");
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editRow(page, "projects", 3);
  await editor.press("Control+ArrowDown");
  await editor.press("Shift+Enter");
  assert.equal(await activeRow(page).getAttribute("data-parent-key"), null);
  assert.equal(await rowAt(page, "projects").locator('[data-ui="outline-inline-content"]').textContent(), "Projects");
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await editRow(page, "projects/home-lab", 0);
  const position = Number(await rowAt(page, "projects/home-lab").getAttribute("aria-posinset"));
  await editor.press("Enter");
  assert.equal(await editor.textContent(), "");
  assert.equal(await activeRow(page).getAttribute("aria-posinset"), String(position));
  assert.equal(
    await rowAt(page, "projects/home-lab").locator('[data-ui="outline-inline-content"]').textContent(),
    "Home lab notes #project",
  );
});

designSystemTest("Tana indentation and sibling ordering preserve the editor and its selection", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const editor = await editRow(page, "projects/home-lab", 2, 6);
  await editor.press("Tab");
  await rowAt(page, "projects/lode/home-lab").locator('[data-ui="outline-editor"]').waitFor();
  assert.deepEqual(await selection(editor), { from: 2, to: 6 });
  assert.equal(await editor.textContent(), "Home lab notes #{project}");
  await editor.press("Shift+Tab");
  await rowAt(page, "projects/home-lab").locator('[data-ui="outline-editor"]').waitFor();
  assert.deepEqual(await selection(editor), { from: 2, to: 6 });
  await editor.press("Alt+Shift+ArrowUp");
  assert.equal(await activeRow(page).getAttribute("aria-posinset"), "1");
  assert.deepEqual(await selection(editor), { from: 2, to: 6 });
  await editor.press("Alt+Shift+ArrowDown");
  assert.equal(await activeRow(page).getAttribute("aria-posinset"), "2");
  assert.deepEqual(await selection(editor), { from: 2, to: 6 });
});

designSystemTest("Tana disclosure, node navigation and task toggle keep keyboard editing coherent", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const editor = await editRow(page, "projects", 2);
  await editor.press("Control+ArrowUp");
  assert.equal(await rowAt(page, "projects").getAttribute("aria-expanded"), "false");
  assert.deepEqual(await selection(editor), { from: 2, to: 2 });
  await editor.press("Control+ArrowDown");
  assert.equal(await rowAt(page, "projects").getAttribute("aria-expanded"), "true");
  assert.deepEqual(await selection(editor), { from: 2, to: 2 });
  await editor.press("Control+Shift+PageUp");
  assert.equal(await rowAt(page, "projects").getAttribute("aria-expanded"), "false");
  await editor.press("Control+ArrowDown");
  assert.equal(await rowAt(page, "projects/lode").getAttribute("aria-expanded"), "false");
  await editor.press("Control+Shift+PageDown");
  assert.equal(await rowAt(page, "projects/lode").getAttribute("aria-expanded"), "true");
  assert.deepEqual(await selection(editor), { from: 2, to: 2 });
  await editor.press("Control+Enter");
  assert.equal(await rowAt(page, "projects").getByRole("checkbox").isChecked(), false);
  await editor.press("Control+Enter");
  assert.equal(await rowAt(page, "projects").getByRole("checkbox").isChecked(), true);
  await editor.press("ArrowDown");
  assert.equal(await activeRow(page).getAttribute("data-item-key"), key("projects/lode"));
  assert.deepEqual(await selection(editor), { from: 0, to: 0 });
});

designSystemTest("Tana explicit node deletion removes its subtree and keeps adjacent text editing", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const editor = await editRow(page, "projects/lode", 2);
  assert.equal(await rowAt(page, "projects/lode/roadmap").count(), 1);
  await editor.press("Control+Shift+Backspace");
  assert.equal(await rowAt(page, "projects/lode").count(), 0);
  assert.equal(await rowAt(page, "projects/lode/roadmap").count(), 0);
  assert.equal(await activeRow(page).getAttribute("data-item-key"), key("projects"));
  assert.equal(await editor.textContent(), "Projects");
  assert.deepEqual(await selection(editor), { from: 8, to: 8 });
});

designSystemTest("Modified text arrows at node boundaries do not navigate to another editor", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const editor = await editRow(page, "projects/home-lab", 0);
  await editor.press("Shift+ArrowLeft");
  assert.equal(await activeRow(page).getAttribute("data-item-key"), key("projects/home-lab"));
  await editor.press("Control+ArrowLeft");
  assert.equal(await activeRow(page).getAttribute("data-item-key"), key("projects/home-lab"));
  await editor.press("Control+Shift+ArrowRight");
  assert.equal(await activeRow(page).getAttribute("data-item-key"), key("projects/home-lab"));
  await page.waitForFunction(() => document.querySelector('[data-ui="outline-editor"]').editor.state.selection.to > 1);
  assert.ok((await selection(editor)).to > 0);
});

designSystemTest("Tana backspace protects child subtrees and merges a leaf at the join", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const editor = await editRow(page, "projects/lode", 0);
  const count = await page.locator('[data-ui="outline-row"]').count();
  await editor.press("Backspace");
  assert.equal(await page.locator('[data-ui="outline-row"]').count(), count);
  assert.equal(await editor.textContent(), "Lode #{project}");
  await editRow(page, "projects/home-lab", 4);
  await editor.press("Shift+Enter");
  await editor.pressSequentially("Tail");
  await editor.evaluate((element) => element.editor.commands.setTextSelection(1));
  await editor.press("Backspace");
  assert.equal(await activeRow(page).getAttribute("data-item-key"), key("projects/home-lab"));
  assert.equal(await editor.textContent(), "Home lab notes #{project}Tail");
  assert.equal((await selection(editor)).from, "Home lab notes #{project}".length);
});

designSystemTest("Tana Enter after Escape uses the retained text position", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const editor = await editRow(page, "projects/home-lab", 4);
  await editor.press("Escape");
  await page.keyboard.press("Enter");
  assert.equal(await editor.textContent(), " lab notes #{project}");
  assert.equal(
    await rowAt(page, "projects/home-lab").locator('[data-ui="outline-inline-content"]').textContent(),
    "Home",
  );
});
