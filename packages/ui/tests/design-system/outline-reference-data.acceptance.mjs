import assert from "node:assert/strict";

import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

const rowAt = (page, path) => page.locator(`[data-item-key="outline-item:${encodeURIComponent(path)}"]`);
const body = (row) => row.locator('[data-ui="outline-inline-content"]');
const edit = async (page, row) => {
  await row.locator('[data-ui="outline-row-text"]').click();
  const editor = page.locator('[data-ui="outline-editor"]');
  await editor.waitFor({ state: "visible" });
  return editor;
};
const leave = async (page) => {
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await page.locator('[data-ui="outline-editor"]').waitFor({ state: "detached" });
};

designSystemTest("field references edit their shared target and recover completed Supertag source", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const owner = rowAt(page, "projects/lode/owner-field/kei-owner");
  const original = rowAt(page, "kei");
  const editor = await edit(page, owner);
  await editor.press("End");
  await editor.press("Backspace");
  assert.equal(await body(original).textContent(), "Kei #{person", "an incomplete edit propagates to the same target");
  assert.equal(
    await owner.locator('[data-appearance="reference"]').count(),
    1,
    "editing never detaches the occurrence",
  );
  await leave(page);
  await edit(page, owner);
  await editor.press("End");
  await editor.pressSequentially("}");
  assert.equal(await original.locator('[data-ui="outline-row-badge"]').textContent(), "#person");
  await leave(page);
  assert.equal(await owner.locator('[data-ui="outline-row-badge"]').textContent(), "#person");
  assert.equal(await owner.locator('[data-appearance="reference"]').count(), 1);
  await edit(page, original);
  await editor.press("Control+a");
  await editor.pressSequentially("New Kei #{person}");
  assert.equal(await body(owner).textContent(), "New Kei #person", "edits also propagate from the Original");
});

designSystemTest("closed source resolves without a completion selection or editor history", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const row = rowAt(page, "inbox/quick-capture");
  const editor = await edit(page, row);
  await editor.pressSequentially("@{Local-first software essay} #{person}");
  await leave(page);
  assert.equal(await row.locator('[data-ui="outline-reference"]').getAttribute("data-reference-id"), "local-first");
  assert.equal(await row.locator('[data-ui="outline-row-badge"]').textContent(), "#person");
  await edit(page, row);
  await editor.press("End");
  await editor.press("Backspace");
  await leave(page);
  assert.equal(await row.locator('[data-ui="outline-row-badge"]').count(), 0);
  await edit(page, row);
  await editor.press("End");
  await editor.pressSequentially("}");
  await leave(page);
  assert.equal(await row.locator('[data-ui="outline-row-badge"]').textContent(), "#person");
});

designSystemTest("choosing a field target never writes the replacement into the previous target", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const owner = rowAt(page, "projects/lode/owner-field/kei-owner");
  const original = rowAt(page, "kei");
  const editor = await edit(page, owner);
  await editor.press("Control+a");
  await editor.press("Backspace");
  assert.equal(await body(original).textContent(), "", "direct content editing changes the existing target");
  await page
    .getByRole("listbox", { name: "Suggested values" })
    .getByRole("option", { name: "Lode team", exact: true })
    .click();
  await leave(page);
  assert.equal(await body(original).textContent(), "", "retargeting preserves the previous target's committed content");
  assert.equal(await body(owner).textContent(), "Lode team");
  assert.equal(await owner.locator('[data-appearance="reference"]').count(), 1);
});
