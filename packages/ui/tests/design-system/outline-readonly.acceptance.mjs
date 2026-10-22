import assert from "node:assert/strict";

import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

const rowAt = (page, path) => page.locator(`[data-item-key="outline-item:${encodeURIComponent(path)}"]`);

designSystemTest("outline readonly names retain their cursor without tooltips", async (page) => {
  await navigateToCatalogPage(page, "components/outline");
  const field = rowAt(page, "projects/lode/status-field");
  const text = field.locator('[data-ui="outline-readonly-text"]');
  const following = rowAt(page, "projects/lode/status-field/in-progress");
  const before = { row: await field.boundingBox(), following: await following.boundingBox() };
  const cursor = await text.evaluate((element) => getComputedStyle(element).cursor);
  assert.match(cursor, /url\(/, "readonly text uses the small custom editing cursor");
  const dimensions = await text.evaluate(async (element) => {
    const image = new Image();
    image.src = getComputedStyle(element).cursor.match(/url\("([^"]+)"\)/)[1];
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  });
  assert.deepEqual(dimensions, [20, 20]);
  assert.equal(
    await field.locator('[data-ui="outline-bullet"]').evaluate((element) => getComputedStyle(element).cursor),
    "pointer",
  );
  await text.hover();
  const hint = page.getByRole("tooltip");
  await page.waitForTimeout(650);
  assert.equal(await hint.count(), 0, "hovering readonly text does not show a tooltip");
  assert.equal(await field.getAttribute("aria-description"), "Name comes from the field definition.");
  assert.deepEqual(
    { row: await field.boundingBox(), following: await following.boundingBox() },
    before,
    "readonly interactions do not move the row or following bullets",
  );
  await page.mouse.move(1, 1);
  await text.dblclick();
  assert.equal(
    await page.evaluate(() => window.getSelection()?.toString()),
    "Status",
    "readonly names remain selectable for copying",
  );
  assert.equal(await hint.count(), 0);
  const tree = page.getByRole("tree");
  await tree.press("Escape");
  await tree.press("Enter");
  assert.equal(await hint.count(), 0);
  assert.equal(await page.locator('[data-ui="outline-editor"]').count(), 0);
  await tree.press("ArrowDown");
  await tree.press("Enter");
  await page.locator('[data-ui="outline-editor"]').waitFor({ state: "visible" });
  await page.locator('[data-ui="outline-editor"]').press("Escape");
  const daily = rowAt(page, "daily-notes");
  await daily.locator('[data-ui="outline-readonly-text"]').click();
  assert.equal(await hint.count(), 0);
  await daily.locator('[data-ui="outline-bullet"]').click();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByText("Daily notes", { exact: true }).waitFor();
});

designSystemTest("outline readonly names stay non-editable on touch without tooltips", async (page) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  try {
    await navigateToCatalogPage(page, "components/outline");
    const label = rowAt(page, "projects/lode/status-field").locator('[data-ui="outline-readonly-text"]');
    await label.scrollIntoViewIfNeeded();
    const box = await label.boundingBox();
    assert.ok(box !== null);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const hint = page.getByRole("tooltip");
    assert.equal(await hint.count(), 0);
    assert.equal(await page.locator('[data-ui="outline-editor"]').count(), 0);
    await page.getByRole("heading", { name: "Outline", exact: true }).click();
  } finally {
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await session.detach();
  }
});
