import assert from "node:assert/strict";
import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";
const row = (page, path) =>
  page.locator(`[data-ui="outline-row"][data-item-key="outline-item:${encodeURIComponent(path)}"]`);
const editor = (page) => page.locator('[data-ui="outline-editor"]');

designSystemTest(
  "Host command completions honor exit policy unless the command returns a focus destination",
  async (page) => {
    await page.evaluate(() => {
      window.location.hash = "#/outline-command-fixture";
    });
    const tree = page.getByRole("tree", { name: "External outline" });
    await tree.locator('[data-ui="outline-row-text"]').click();
    await editor(page).pressSequentially("!");
    await page.getByRole("option", { name: "run", exact: true }).click();
    await editor(page).waitFor({ state: "detached" });
    assert.equal(await page.getByLabel("Command invocations").textContent(), "1");
    await tree.locator('[data-ui="outline-row-text"]').click();
    await editor(page).press("Control+a");
    await editor(page).pressSequentially("!");
    await page.getByRole("option", { name: "focus", exact: true }).click();
    await page.locator('[data-ui="outline-editor"]:focus').waitFor();
    assert.equal(await editor(page).textContent(), "Accepted");
    assert.equal(await editor(page).evaluate((el) => el.editor.state.selection.from), 1);
    assert.equal(await page.getByLabel("Command invocations").textContent(), "2");
    await editor(page).press("Alt+r");
    assert.equal(
      await page.getByLabel("Command invocations").textContent(),
      "3",
      "arbitrary external chords use the same executor",
    );
  },
);

designSystemTest(
  "Host task commands deduplicate referenced targets and undo the whole selection once",
  async (page) => {
    await navigateToCatalogPage(page, "components/outline");
    const reference = row(page, "projects/lode/owner-field/kei-owner");
    const original = row(page, "kei");
    const other = row(page, "projects/home-lab");
    await original.click();
    await editor(page).press("Escape");
    await reference.click({ modifiers: ["Control"] });
    await other.click({ modifiers: ["Control"] });
    await page.keyboard.press("Control+Enter");
    for (const item of [reference, original, other]) {
      assert.equal(await item.getByRole("checkbox").isChecked(), false, "one command adds one open task per Node");
    }
    await page.keyboard.press("Control+Enter");
    for (const item of [reference, original, other]) {
      assert.equal(await item.getByRole("checkbox").isChecked(), true, "shared target toggles once");
    }
    await page.keyboard.press("Control+z");
    for (const item of [reference, original, other]) {
      assert.equal(await item.getByRole("checkbox").isChecked(), false, "one undo reverts every target");
    }
    await page.keyboard.press("Control+z");
    for (const item of [reference, original, other]) assert.equal(await item.getByRole("checkbox").count(), 0);
  },
);

designSystemTest("Command panel, selection toolbar and checkbox execute host task operations", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const target = row(page, "inbox/quick-capture");
  await target.click();
  await editor(page).pressSequentially("/task");
  await page.getByRole("option", { name: /Make task/ }).click();
  assert.equal(await editor(page).textContent(), "");
  assert.equal(await target.getByRole("checkbox").isChecked(), false);
  await editor(page).press("Escape");
  await page.getByRole("toolbar").getByRole("button", { name: "Toggle task", exact: true }).click();
  assert.equal(await target.getByRole("checkbox").isChecked(), true);
  await target.getByRole("checkbox").click();
  assert.equal(await target.getByRole("checkbox").isChecked(), false);
});

designSystemTest(
  "A collapsed text caret copies and cuts its node while character selections stay native",
  async (page) => {
    await navigateToCatalogPage(page, "components/outline");
    const target = row(page, "inbox/crdt-survey");
    await target.click();
    const copy = (cut = false) =>
      editor(page).evaluate((element, cut) => {
        const data = new DataTransfer();
        const event = new ClipboardEvent(cut ? "cut" : "copy", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        });
        element.dispatchEvent(event);
        return {
          text: data.getData("text/plain"),
          data: data.getData("application/x-lode-outline"),
          selection: element.editor.state.selection.toJSON(),
          selectedText: window.getSelection()?.toString(),
        };
      }, cut);
    assert.equal(await page.locator('[data-selected="true"][data-ui="outline-row"]').count(), 0);
    assert.equal(JSON.parse((await copy()).data).length, 1);
    await editor(page).evaluate((element) => element.editor.commands.setTextSelection({ from: 1, to: 5 }));
    const textCopy = await copy();
    assert.equal(textCopy.data, "", "character selections do not become node copies");
    assert.equal(textCopy.text, "CRDT");
    await editor(page).press("ArrowRight");
    await page.waitForFunction(() => document.querySelector('[data-ui="outline-editor"]').editor.state.selection.empty);
    const cut = await copy(true);
    assert.ok(cut.data, JSON.stringify(cut));
    assert.equal(JSON.parse(cut.data).length, 1);
    assert.equal(await target.count(), 0);
    await page.keyboard.press("Control+z");
    assert.equal(await target.count(), 1);
  },
);

designSystemTest("Escape cancels outline dragging and leaving a row cancels its delayed expansion", async (page) => {
  await page.setViewportSize({ width: 1280, height: 1800 });
  await navigateToCatalogPage(page, "components/outline");
  const source = row(page, "projects/home-lab");
  const target = row(page, "projects/lode");
  const from = await source.locator('[data-ui="outline-bullet"]').boundingBox();
  const to = await target.locator('[data-ui="outline-bullet"]').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y, { steps: 5 });
  await page.locator('[data-ui="outline-drop-indicator"]').waitFor({ state: "attached" });
  await page.keyboard.press("Escape");
  await page.locator('[data-ui="outline-drop-indicator"]').waitFor({ state: "detached" });
  await page.mouse.up();
  assert.equal(await source.getAttribute("data-parent-key"), "outline-item:projects");
  const collapsed = row(page, "inbox/local-first-original");
  await collapsed.scrollIntoViewIfNeeded();
  const hover = await collapsed.locator('[data-ui="outline-bullet"]').boundingBox();
  const leaf = await row(page, "inbox/crdt-survey").locator('[data-ui="outline-bullet"]').boundingBox();
  await page.mouse.move(leaf.x + 10, leaf.y + 10);
  await page.mouse.down();
  await page.mouse.move(hover.x + 10, hover.y + 10, { steps: 3 });
  await page.mouse.move(leaf.x + 10, leaf.y + 10, { steps: 3 });
  await page.waitForTimeout(650);
  assert.equal(await collapsed.getAttribute("aria-expanded"), "false");
  await page.keyboard.press("Escape");
  await page.mouse.up();
});
