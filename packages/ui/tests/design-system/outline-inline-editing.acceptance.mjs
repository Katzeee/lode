import assert from "node:assert/strict";

import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

designSystemTest("outline source editing keeps single-line rows and following bullets stable", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const tree = page.getByRole("tree");
  const geometry = () =>
    tree.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      return Array.from(element.querySelectorAll('[data-ui="outline-row"]')).map((row) => ({
        key: row.getAttribute("data-item-key"),
        height: row.getBoundingClientRect().height,
        bulletTop: row.querySelector('[data-ui="outline-bullet-mark"]').getBoundingClientRect().top - top,
      }));
    });
  for (const path of ["projects/lode/roadmap/command-palette", "projects/lode"]) {
    const row = tree.locator(`[data-item-key="outline-item:${encodeURIComponent(path)}"]`);
    const before = await geometry();
    await row.locator('[data-ui="outline-row-text"]').click();
    const editor = page.locator('[data-ui="outline-editor"]');
    await editor.waitFor({ state: "visible" });
    assert.deepEqual(await geometry(), before, "entering source editing preserves row heights and bullet positions");
    await page.getByRole("heading", { name: "Outline", exact: true }).click();
    await editor.waitFor({ state: "detached" });
    assert.deepEqual(await geometry(), before, "leaving source editing preserves row heights and bullet positions");
  }
});

async function startEmptyEditor(page) {
  await navigateToCatalogPage(page, "components/outline");
  const row = page.locator('[data-item-key="outline-item:inbox%2Fquick-capture"]');
  await row.locator('[data-ui="outline-row-text"]').click();
  const editor = page.locator('[data-ui="outline-editor"]');
  await editor.waitFor({ state: "visible" });
  return { editor, row };
}

designSystemTest("outline completions close at spaces and stay closed after completed tokens", async (page) => {
  const { editor } = await startEmptyEditor(page);
  for (const [trigger, label, option, source] of [
    ["@", "References", "Local-first software essay", "@{Local-first software essay}"],
    ["#", "Supertags", "project", "#{project}"],
    ["/", "Commands", "Bold", "**bold**"],
  ]) {
    await editor.press("Control+a");
    await editor.pressSequentially(trigger);
    const panel = page.getByRole("listbox", { name: label });
    await panel.waitFor({ state: "visible" });
    await editor.press("Space");
    assert.equal(await page.getByRole("listbox").count(), 0, "a space ends a bare trigger");
    await editor.pressSequentially("ordinary text");
    assert.equal(await page.getByRole("listbox").count(), 0, "ordinary text does not revive an earlier trigger");
    await editor.press("Control+a");
    await editor.pressSequentially(trigger);
    await panel.getByRole("option", { name: option, exact: option !== "Bold" }).click();
    await editor.press("Space");
    await editor.pressSequentially("more text");
    assert.equal(await editor.textContent(), `${source} more text`);
    assert.equal(await page.getByRole("listbox").count(), 0, "typing after completed content never reopens its search");
  }
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  const row = page.locator('[data-item-key="outline-item:projects%2Flode%2Froadmap%2Fcommand-palette"]');
  await row.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor();
  await editor.press("End");
  await editor.press("Space");
  assert.equal(
    await page.getByRole("listbox").count(),
    0,
    "an existing reference does not capture the following space",
  );
});

designSystemTest("outline formatting reveals editable source and preserves the clicked caret", async (page) => {
  const { editor, row } = await startEmptyEditor(page);
  await editor.pressSequentially("Read bold today");
  await editor.evaluate((element) => element.editor.commands.setTextSelection({ from: 6, to: 10 }));
  await editor.press("Control+b");
  assert.equal(await editor.textContent(), "Read **bold** today");
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  await row.locator("strong").waitFor();
  assert.equal(await row.locator("strong").textContent(), "bold");
  assert.equal(await editor.count(), 0);
  await row.locator("strong").scrollIntoViewIfNeeded();
  const point = await row.locator("strong").evaluate((element) => {
    const text = element.querySelector("[data-source-start]").firstChild;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 2);
    const bounds = range.getBoundingClientRect();
    return { x: bounds.right - 0.25, y: (bounds.top + bounds.bottom) / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await editor.waitFor();
  assert.equal(await editor.textContent(), "Read **bold** today");
  assert.equal(
    await editor.evaluate((element) => element.editor.state.selection.from - 1),
    9,
    "opening formatted text maps the clicked character to its source position",
  );
  await editor.press("End");
  await editor.pressSequentially("!");
  await editor.press("Control+z");
  assert.equal(await editor.textContent(), "Read **bold** today");
  await editor.press("Control+Shift+z");
  assert.equal(await editor.textContent(), "Read **bold** today!");
});

designSystemTest("outline references and Supertags store closed source with target identity", async (page) => {
  const { editor, row } = await startEmptyEditor(page);
  await editor.pressSequentially("[[");
  assert.equal(await page.getByRole("listbox").count(), 0);
  await editor.press("Control+a");
  await editor.pressSequentially("@Local-first");
  await page
    .getByRole("listbox", { name: "References" })
    .getByRole("option", { name: "Local-first software essay", exact: true })
    .click();
  assert.equal(await editor.textContent(), "@{Local-first software essay}");
  await editor.pressSequentially(" #pro");
  await page.getByRole("listbox", { name: "Supertags" }).getByRole("option", { name: "project", exact: true }).click();
  assert.equal(await editor.textContent(), "@{Local-first software essay} #{project}");
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  assert.equal(await row.locator('[data-ui="outline-reference"]').getAttribute("data-reference-id"), "local-first");
  assert.equal(await row.locator('[data-ui="outline-row-badge"]').textContent(), "#project");
  await row.locator('[data-ui="outline-row-text"]').click();
  await editor.waitFor();
  assert.equal(await editor.textContent(), "@{Local-first software essay} #{project}");
  await editor.evaluate((element) =>
    element.editor.commands.setTextSelection({ from: 3, to: 3 + "Local-first software essay".length }),
  );
  await editor.pressSequentially("CRDT");
  await page
    .getByRole("listbox", { name: "References" })
    .getByRole("option", { name: "CRDT ordering survey", exact: true })
    .click();
  assert.equal(await editor.textContent(), "@{CRDT ordering survey} #{project}");
  await page.getByRole("heading", { name: "Outline", exact: true }).click();
  assert.equal(await row.locator('[data-ui="outline-reference"]').getAttribute("data-reference-id"), "crdt-survey");
});

designSystemTest(
  "outline consumes external triggers and renderers without installing domain defaults",
  async (page) => {
    await page.evaluate(() => {
      window.location.hash = "#/outline-extension-fixture";
    });
    const tree = page.getByRole("tree", { name: "External outline" });
    await tree.waitFor();
    await tree.locator('[data-ui="outline-row-text"]').click();
    const editor = page.locator('[data-ui="outline-editor"]');
    await editor.waitFor();
    await editor.pressSequentially("@ # / **bold**");
    await editor.press("Control+Enter");
    assert.equal(await editor.textContent(), "@ # / **bold**", "no host command means no product action or insertion");
    assert.equal(await page.getByRole("listbox").count(), 0, "the core installs no @, # or / trigger");
    await page.getByLabel("Saved document").click();
    assert.equal(await tree.locator("strong").count(), 0, "formatting is explicitly installed by the host");
    await tree.locator('[data-ui="outline-row-text"]').click();
    await editor.press("Control+a");
    await editor.pressSequentially("^");
    const panel = page.getByRole("listbox", { name: "External choices" });
    await panel.waitFor();
    assert.equal(await panel.locator("em").textContent(), " supplied by host");
    await editor.press("Enter");
    assert.equal(await editor.textContent(), "%{Ticket}");
    await page.getByLabel("Saved document").click();
    assert.equal(await tree.locator('[data-ui="host-ticket"]').textContent(), "Ticket");
    const saved = JSON.parse(await page.getByLabel("Saved document").textContent());
    assert.deepEqual(saved, [
      {
        data: { id: "issue-42" },
        extension: "ticket",
        label: "Ticket",
        source: "%{Ticket}",
        type: "token",
      },
    ]);
  },
);
