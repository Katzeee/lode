import assert from "node:assert/strict";

import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

designSystemTest("overlays remain reachable in a short viewport", verifyOverlaysAtShortViewport);

async function verifyOverlaysAtShortViewport(page) {
  const viewport = { height: 390, label: "phone landscape", width: 844 };
  await page.setViewportSize({ height: viewport.height, width: viewport.width });
  await navigateToCatalogPage(page, "components/overlays");

  await page.getByRole("button", { name: "Open dialog" }).click();
  const dialog = page.locator('[role="dialog"].lode-overlay-popup');
  await dialog.waitFor({ state: "visible" });
  const dialogBox = await dialog.boundingBox();
  assert.ok(dialogBox !== null, "the Dialog must be measurable on a landscape phone");
  assertWithinViewport(dialogBox, viewport, "Dialog");
  const confirm = page.getByRole("button", { name: "Save changes" });
  await confirm.scrollIntoViewIfNeeded();
  assert.equal(await confirm.isVisible(), true, "the Dialog actions must stay reachable on a landscape phone");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });

  await page.getByRole("button", { name: "Show toast" }).click();
  const toast = page.locator('[data-ui="toast"]');
  await toast.waitFor({ state: "visible" });
  const toastBox = await toast.boundingBox();
  assert.ok(toastBox !== null, "the Toast must be measurable on a landscape phone");
  assertWithinViewport(toastBox, viewport, "Toast");
  await toast.locator('[data-ui="toast-close"]').click();
  await toast.waitFor({ state: "detached" });
}

function assertWithinViewport(box, viewport, label) {
  const fits =
    box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
  assert.ok(
    fits,
    `${label} must fit inside the ${viewport.label} viewport; got ${String(Math.round(box.width))}×${String(Math.round(box.height))} at (${String(Math.round(box.x))}, ${String(Math.round(box.y))})`,
  );
}
