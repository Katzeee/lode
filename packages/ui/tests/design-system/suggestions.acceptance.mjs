import assert from "node:assert/strict";

import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

const active = (panel) => panel.locator('[role="option"][aria-selected="true"]');

designSystemTest("suggestions preserve the external query and use the registered candidate renderer", async (page) => {
  await page.evaluate(() => {
    window.location.hash = "#/outline-extension-fixture";
  });
  const tree = page.getByRole("tree", { name: "External outline" });
  await tree.locator('[data-ui="outline-row-text"]').click();
  const editor = page.locator('[data-ui="outline-editor"]');
  await editor.waitFor();
  await editor.pressSequentially("^  query  ");
  const panel = page.getByRole("listbox", { name: "External choices" });
  await panel.waitFor();
  assert.equal(await panel.locator('[data-ui="provided-query"]').textContent(), '"  query  "');
  assert.match(await panel.getByRole("option").textContent(), /^Ticket supplied by host/);
  assert.doesNotMatch(await panel.textContent(), /Untitled/);
  await editor.press("Enter");
  assert.equal(await editor.textContent(), "%{Ticket}");
});

designSystemTest("node providers exclude unnamed field targets from suggestions", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const row = page.locator('[data-item-key="outline-item:projects%2Flode%2Fowner-field%2Fteam-owner"]');
  await row.locator('[data-ui="outline-row-text"]').click();
  const editor = page.locator('[data-ui="outline-editor"]');
  await editor.waitFor();
  await editor.press("Control+a");
  await editor.press("Backspace");
  const panel = page.getByRole("listbox", { name: "Suggested values" });
  await panel.waitFor();
  assert.deepEqual(await panel.getByRole("option").allTextContents(), ["Kei"]);
  await editor.press("Tab");
  await panel.waitFor({ state: "detached" });
  assert.equal(await editor.textContent(), "Kei #{person}");
  assert.equal(await row.locator('[data-appearance="reference"]').count(), 1);
  await editor.press("Control+a");
  await editor.press("Backspace");
  await panel.getByRole("status").waitFor({ state: "visible" });
  assert.equal(await panel.getByRole("option").count(), 0);
  assert.equal(await panel.textContent(), "No matching suggested values");
});

async function visibleSelection(panel) {
  const listBox = await panel.boundingBox();
  const itemBox = await active(panel).boundingBox();
  assert.ok(listBox !== null && itemBox !== null);
  assert.ok(
    itemBox.y >= listBox.y - 1 && itemBox.y + itemBox.height <= listBox.y + listBox.height + 1,
    "the active suggestion stays entirely within the list viewport",
  );
}
async function catalogEditor(page) {
  await navigateToCatalogPage(page, "components/outline");
  const row = page.locator('[data-item-key="outline-item:inbox%2Fquick-capture"]');
  await row.locator('[data-ui="outline-row-text"]').click();
  const editor = page.locator('[data-ui="outline-editor"]');
  await editor.waitFor();
  return { editor, row };
}
async function fixtureEditor(page) {
  await page.evaluate(() => {
    window.location.hash = "#/outline-suggestion-fixture";
  });
  await page.getByRole("tree", { name: "Suggestion fixture" }).locator('[data-ui="outline-row-text"]').click();
  const editor = page.locator('[data-ui="outline-editor"]');
  await editor.waitFor();
  await editor.pressSequentially("~");
  const panel = page.getByRole("listbox", { name: "Test suggestions" });
  await panel.waitFor();
  return { editor, panel };
}

designSystemTest("suggestions scroll with keyboard selection while the editor retains focus", async (page) => {
  const { editor } = await catalogEditor(page);
  await editor.pressSequentially("@");
  const panel = page.getByRole("listbox", { name: "References" });
  await panel.waitFor();
  const pageY = await page.evaluate(() => window.scrollY);
  for (let index = 0; index < 12; index += 1) {
    await editor.press("ArrowDown");
    await visibleSelection(panel);
    assert.equal(await editor.evaluate((element) => document.activeElement === element), true);
    assert.equal(await editor.getAttribute("aria-controls"), await panel.getAttribute("id"));
    assert.equal(await editor.getAttribute("aria-activedescendant"), await active(panel).getAttribute("id"));
  }
  assert.ok((await panel.evaluate((element) => element.scrollTop)) > 0);
  assert.equal(await page.evaluate(() => window.scrollY), pageY, "list navigation does not scroll the page");
  await editor.press("PageUp");
  await visibleSelection(panel);
  await editor.press("PageDown");
  await visibleSelection(panel);
  await editor.press("Escape");
  await panel.waitFor({ state: "detached" });
  assert.equal(await editor.getAttribute("aria-activedescendant"), null);
  assert.equal(await editor.getAttribute("aria-controls"), null);
  assert.equal(await editor.evaluate((element) => document.activeElement === element), true);
});

for (const acceptKey of ["Tab", "Enter"]) {
  designSystemTest(`suggestions accept with ${acceptKey} without structural edits`, async (page) => {
    const { editor, row } = await catalogEditor(page);
    const count = await page.locator('[data-ui="outline-row"]').count();
    const parent = await row.getAttribute("data-parent-key");
    await editor.pressSequentially("/");
    const panel = page.getByRole("listbox", { name: "Commands" });
    await panel.waitFor();
    assert.equal(await panel.locator('[data-ui="suggestion-leading"]').count(), 5);
    await editor.press("ArrowDown");
    await editor.press("ArrowDown");
    assert.match(await active(panel).textContent(), /Bold/);
    await editor.press(acceptKey);
    await panel.waitFor({ state: "detached" });
    assert.equal(await editor.textContent(), "**bold**");
    assert.equal(await row.getAttribute("data-parent-key"), parent);
    assert.equal(await page.locator('[data-ui="outline-row"]').count(), count);
    assert.equal(await editor.evaluate((element) => document.activeElement === element), true);
  });
}

designSystemTest("suggestions retain identity across refresh and page through variable-height rows", async (page) => {
  const { editor, panel } = await fixtureEditor(page);
  const initialId = await active(panel).getAttribute("id");
  await page.getByRole("button", { name: "Refresh suggestions" }).click();
  assert.equal(await active(panel).getAttribute("id"), initialId);
  await visibleSelection(panel);
  await editor.press("ArrowUp");
  const chosenId = await active(panel).getAttribute("id");
  await page.getByRole("button", { name: "Refresh suggestions" }).click();
  assert.equal(await active(panel).getAttribute("id"), chosenId);
  await editor.press("Control+Home");
  assert.match(await active(panel).textContent(), /^Suggestion 0/);
  await editor.press("PageDown");
  const nextIndex = Number((await active(panel).textContent()).match(/Suggestion (\d+)/)[1]);
  assert.ok(nextIndex > 1);
  await visibleSelection(panel);
  await editor.press("PageUp");
  const previousIndex = Number((await active(panel).textContent()).match(/Suggestion (\d+)/)[1]);
  assert.ok(previousIndex < nextIndex - 1);
  await visibleSelection(panel);
  await editor.press("Control+End");
  assert.equal(await active(panel).textContent(), "Suggestion 15");
  await visibleSelection(panel);
});

designSystemTest("suggestions respect registered acceptance chords and guards", async (page) => {
  const { editor, panel } = await fixtureEditor(page);
  const events = async () => JSON.parse(await page.getByLabel("Suggestion events").textContent());
  await editor.press("Control+Enter");
  assert.deepEqual((await events()).accepted, [], "the host's acceptance guard can reject the active item");
  await editor.press("Enter");
  assert.equal((await events()).created, 1, "an explicitly unbound Enter returns to the editor");
  await editor.press("Tab");
  assert.match(await active(panel).textContent(), /^Suggestion 1$/);
  assert.deepEqual((await events()).accepted, [], "the host can register Tab as navigation");
  await editor.press("Control+Shift+Enter");
  assert.deepEqual((await events()).accepted, [], "extra modifiers do not match a registered chord");
  await editor.press("Control+Enter");
  assert.equal(await editor.textContent(), "Selected 1");
  assert.deepEqual(await events(), { accepted: ["choice-1"], moves: 0, created: 2 });
  await panel.waitFor({ state: "detached" });
});

designSystemTest(
  "suggestions handle empty results and composing input without accepting hidden items",
  async (page) => {
    const { editor, panel } = await fixtureEditor(page);
    await editor.pressSequentially("none");
    await panel.getByRole("status").waitFor({ state: "visible", timeout: 3000 });
    assert.equal(await panel.getByRole("option").count(), 0, `empty query source: ${await editor.textContent()}`);
    assert.equal(await editor.getAttribute("aria-activedescendant"), null);
    await editor.press("ArrowDown");
    await panel.waitFor({ state: "detached" });
    await editor.press("Control+a");
    await editor.pressSequentially("~");
    await panel.waitFor();
    const before = await active(panel).getAttribute("id");
    await editor.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }));
      for (const key of ["ArrowDown", "Enter", "Tab"]) {
        element.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, isComposing: true }),
        );
      }
      element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中" }));
    });
    assert.equal(await active(panel).getAttribute("id"), before);
    assert.equal(await editor.textContent(), "~");
    assert.deepEqual(JSON.parse(await page.getByLabel("Suggestion events").textContent()).accepted, []);
  },
);
