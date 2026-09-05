import assert from "node:assert/strict";
import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

const row = (page, path) =>
  page.locator(`[data-ui="outline-row"][data-item-key="outline-item:${encodeURIComponent(path)}"]`);
const selected = (page) => page.locator('[data-ui="outline-row"][aria-selected="true"]');
const editor = (page) => page.locator('[data-ui="outline-editor"]');
const node = (row) => row.locator('xpath=ancestor::*[@data-ui="outline-node"][1]');

designSystemTest("Selecting an outline parent covers its subtree with one continuous surface", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const parent = row(page, "projects/lode/roadmap");
  const subtree = node(parent);
  const before = await subtree.boundingBox();
  await parent.locator('[data-ui="outline-row-text"]').click();
  await editor(page).waitFor({ state: "visible" });
  await editor(page).press("Escape");
  const descendants = subtree.locator('[data-ui="outline-row"]');
  assert.equal(await selected(page).count(), await descendants.count());
  assert.equal(await row(page, "projects/lode/engine").getAttribute("aria-selected"), "false");
  assert.equal(
    await subtree.locator('[data-selection-root="true"]').count(),
    0,
    "inherited children have no duplicate surface",
  );
  assert.equal(await subtree.getAttribute("data-selection-root"), "true");
  const styles = await parent.evaluate((element) => ({
    surface: getComputedStyle(element.closest('[data-ui="outline-node"]'), "::before").backgroundColor,
    frame: getComputedStyle(element, "::after").boxShadow,
    inset: getComputedStyle(element, "::after").left,
    background: getComputedStyle(element).backgroundColor,
  }));
  assert.notEqual(styles.surface, "rgba(0, 0, 0, 0)");
  assert.notEqual(styles.frame, "none");
  assert.equal(styles.inset, "-1.5px", "the frame includes the bullet while disclosure stays outside");
  assert.equal(styles.background, "rgba(0, 0, 0, 0)");
  assert.deepEqual(await subtree.boundingBox(), before, "selecting a parent does not change its geometry");
  const toolbar = page.getByRole("toolbar", { name: "1 items selected" });
  const toolBox = await toolbar.boundingBox();
  const parentBox = await parent.boundingBox();
  assert.ok(toolBox && parentBox && toolBox.y + toolBox.height <= parentBox.y, "toolbar follows the selected subtree");
  await editor(page).press("Control+ArrowUp");
  assert.equal(await parent.getAttribute("aria-expanded"), "false");
  assert.equal(await selected(page).count(), 1);
  await editor(page).press("Control+ArrowDown");
  assert.equal(await selected(page).count(), await descendants.count());
  await editor(page).press("Escape");
  assert.equal(await selected(page).count(), 0);
});

designSystemTest("Shift click extends a node selection and Ctrl click adds independent subtree roots", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const parent = row(page, "projects/lode/roadmap");
  await parent.locator('[data-ui="outline-row-text"]').click();
  await editor(page).press("Escape");
  await row(page, "projects/lode/engine").click({ modifiers: ["Shift"] });
  assert.equal(await row(page, "projects/lode/engine").getAttribute("aria-selected"), "true");
  assert.equal(await selected(page).count(), (await node(parent).locator('[data-ui="outline-row"]').count()) + 1);
  await page.getByRole("toolbar", { name: "2 items selected" }).waitFor();
  await row(page, "inbox").click({ modifiers: ["Control"] });
  await page.getByRole("toolbar", { name: "3 items selected" }).waitFor();
  assert.equal(await row(page, "inbox/crdt-survey").getAttribute("aria-selected"), "true");
  await row(page, "inbox").click({ modifiers: ["Control"] });
  assert.equal(await row(page, "inbox/crdt-survey").getAttribute("aria-selected"), "false");
  await parent.locator('[data-ui="outline-row-text"]').click();
  assert.equal(await selected(page).count(), 0);
  assert.equal(await editor(page).count(), 1);
});

designSystemTest(
  "A selected field covers its value column while copying and deleting a parent runs once",
  async (page) => {
    await navigateToCatalogPage(page, "components/outline");
    const field = row(page, "projects/lode/owner-field");
    await field.click({ modifiers: ["Control"] });
    assert.equal(await selected(page).count(), 3);
    assert.notEqual(await node(field).evaluate((el) => getComputedStyle(el, "::after").boxShadow), "none");
    await page.getByRole("heading", { name: "Outline", exact: true }).click();
    await row(page, "inbox").click();
    await editor(page).press("Escape");
    const clipboard = await editor(page).evaluate((element) => {
      const data = new DataTransfer();
      element.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
      return data.getData("application/x-lode-outline");
    });
    const items = JSON.parse(clipboard);
    assert.equal(items.length, 1, "covered descendants are serialized only inside their parent");
    assert.equal(items[0].children.length, 3);
    await editor(page).press("Delete");
    assert.equal(await row(page, "inbox").count(), 0);
    assert.equal(await row(page, "inbox/crdt-survey").count(), 0);
    await editor(page).press("Control+z");
    assert.equal(await row(page, "inbox").count(), 1);
    assert.equal(await row(page, "inbox/crdt-survey").count(), 1);
  },
);
