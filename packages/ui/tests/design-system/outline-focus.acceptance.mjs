import assert from "node:assert/strict";

import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

const key = (path) => `outline-item:${encodeURIComponent(path)}`;
const rowAt = (page, path) => page.locator(`[data-item-key="${key(path)}"]`);

async function editRow(page, path, from, to = from) {
  await rowAt(page, path).locator('[data-ui="outline-row-text"]').click();
  const editor = page.locator('[data-ui="outline-editor"]:focus');
  await editor.waitFor();
  await editor.evaluate((element, range) => element.editor.commands.setTextSelection(range), {
    from: from + 1,
    to: to + 1,
  });
}

async function assertEditing(page, path, from, to = from) {
  await rowAt(page, path).locator('[data-ui="outline-editor"]:focus').waitFor();
  assert.deepEqual(
    await page.evaluate(() => {
      const element = document.activeElement;
      return {
        key: element.closest("[data-item-key]").getAttribute("data-item-key"),
        from: element.editor.state.selection.from - 1,
        to: element.editor.state.selection.to - 1,
      };
    }),
    { key: key(path), from, to },
  );
}

designSystemTest("Tana pointer disclosure keeps the current editor and text selection", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await editRow(page, "projects/lode/roadmap", 2, 6);
  await page.getByRole("button", { name: "Collapse Design system roadmap", exact: true }).click();
  await assertEditing(page, "projects/lode/roadmap", 2, 6);
  await page.getByRole("button", { name: "Expand Design system roadmap", exact: true }).click();
  await assertEditing(page, "projects/lode/roadmap", 2, 6);
  await page.keyboard.type("X");
  assert.equal(await page.locator('[data-ui="outline-editor"]').textContent(), "DeX system roadmap");
});

designSystemTest("Tana disclosure of other nodes and empty children does not move the typing cursor", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await editRow(page, "projects", 3);
  await page.getByRole("button", { name: "Collapse Lode", exact: true }).click();
  await assertEditing(page, "projects", 3);
  await page.getByRole("button", { name: "Expand Lode", exact: true }).click();
  await assertEditing(page, "projects", 3);
  const nodeCount = await page.locator('[data-ui="outline-row"]').count();
  await page.getByRole("button", { name: "Expand Home lab notes", exact: true }).click();
  await assertEditing(page, "projects", 3);
  assert.equal(await page.getByRole("button", { name: "Create child under Home lab notes" }).count(), 1);
  assert.equal(await page.locator('[data-ui="outline-row"]').count(), nodeCount);
  await page.keyboard.type("!");
  assert.equal(await page.locator('[data-ui="outline-editor"]').textContent(), "Pro!jects");
});

designSystemTest("Tana collapsing an edited descendant moves its cursor to the ancestor start", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await editRow(page, "projects/lode/roadmap", "Design system roadmap".length);
  await page.keyboard.type(" draft");
  await page.getByRole("button", { name: "Collapse Projects", exact: true }).click();
  await assertEditing(page, "projects", 0);
  assert.equal(await rowAt(page, "projects/lode/roadmap").count(), 0);
  await page.getByRole("button", { name: "Expand Projects", exact: true }).click();
  await assertEditing(page, "projects", 0);
  assert.equal(
    await rowAt(page, "projects/lode/roadmap").locator('[data-ui="outline-inline-content"]').textContent(),
    "Design system roadmap draft",
  );
  await page.keyboard.type("!");
  assert.equal(await page.locator('[data-ui="outline-editor"]').textContent(), "!Projects");
});

designSystemTest("Tana pointer disclosure resumes text editing after explicit node selection", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  await editRow(page, "projects", 3);
  await page.keyboard.press("Escape");
  await page.locator('[data-ui="outline-editor"]:focus').waitFor();
  await page.getByRole("button", { name: "Expand Home lab notes", exact: true }).click();
  await assertEditing(page, "projects", 3);
  await page.keyboard.type("!");
  assert.equal(await page.locator('[data-ui="outline-editor"]').textContent(), "Pro!jects");
});

designSystemTest(
  "Outline disclosure without an active editing context does not manufacture a selection",
  async (page) => {
    await navigateToCatalogPage(page, "components/outline");
    await page.getByRole("button", { name: "Expand Home lab notes", exact: true }).click();
    assert.equal(await page.locator('[data-ui="outline-editor"]').count(), 0);
    assert.equal(await page.locator('[data-ui="outline-row"][data-selected="true"]').count(), 0);
    await editRow(page, "projects", 3);
    await page.getByRole("heading", { name: "Outline", exact: true }).click();
    await page.getByRole("button", { name: "Collapse Home lab notes", exact: true }).click();
    assert.equal(await page.locator('[data-ui="outline-editor"]').count(), 0);
    assert.equal(
      await rowAt(page, "projects").evaluate((element) => getComputedStyle(element).boxShadow),
      "none",
      "a remembered cursor must not look selected after focus leaves the tree",
    );
  },
);

designSystemTest("Tana checkbox focus owns its keys without invoking tree editing commands", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const path = "projects/lode/roadmap/outline-m2";
  await editRow(page, path, 3);
  const checkbox = rowAt(page, path).getByRole("checkbox");
  await checkbox.click();
  assert.equal(await checkbox.evaluate((element) => element === document.activeElement), true);
  const count = await page.locator('[data-ui="outline-row"]').count();
  await page.keyboard.type("x");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator('[data-ui="outline-row"]').count(), count);
  assert.equal(await page.locator('[data-ui="outline-editor"]').count(), 0);
  assert.equal(
    await rowAt(page, path).locator('[data-ui="outline-inline-content"]').textContent(),
    "Bullet drag and drop",
  );
});
