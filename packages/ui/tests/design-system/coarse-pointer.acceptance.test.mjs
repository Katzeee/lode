import assert from "node:assert/strict";

import { catalogPages } from "../../../design-system-catalog/dist/index.js";
import { designSystemTest, navigateToCatalogPage } from "./support/browser.mjs";

designSystemTest("coarse pointers receive effective touch targets", verifyCoarsePointerBehavior);

async function verifyCoarsePointerBehavior(page) {
  await navigateToCatalogPage(page, "components/overlays");
  await page.getByRole("button", { name: "Show actionable toast" }).click();
  const fineToast = await measureToast(page);
  await dismissToast(page);

  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  try {
    assert.equal(
      await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches),
      true,
      "the touch verification pass must activate (pointer: coarse)",
    );
    const target = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--lode-control-hit-target")),
    );
    assert.equal(target, 48, "the touch target token must resolve to 48px");

    for (const catalogPage of catalogPages) {
      await navigateToCatalogPage(page, catalogPage.path);
      await assertVisibleTouchTargets(page, target, catalogPage.title);
    }

    await navigateToCatalogPage(page, "components/forms");
    const switchControl = page.getByRole("switch").first();
    const switchGeometry = await measureTouchTarget(switchControl);
    assert.equal(switchGeometry.visualHeight, 24, "the visible Switch pill must remain 24px tall");
    assertEffectiveTouchTarget(switchGeometry, target, "Switch");
    await assertExpandedHitArea(page, switchControl, target, "Switch");

    const input = page.locator('input[name="workspace"]');
    await input.scrollIntoViewIfNeeded();
    const inputHitArea = input.locator('xpath=parent::*[@data-ui="input-hit-area"]');
    const inputBox = await input.boundingBox();
    const inputHitBox = await inputHitArea.boundingBox();
    assert.ok(inputBox !== null && inputHitBox !== null, "the Input and its touch wrapper must be visible");
    assert.equal(inputBox.height, 40, "the visible Input must remain 40px tall");
    assert.ok(inputHitBox.height >= target, "the Input wrapper must expose the touch target height");
    await page.mouse.click(inputHitBox.x + inputHitBox.width / 2, inputHitBox.y + 2);
    assert.equal(await input.evaluate((element) => document.activeElement === element), true);

    await navigateToCatalogPage(page, "components/buttons");
    const smallButton = page.getByRole("button", { name: "Size sm" });
    const buttonGeometry = await measureTouchTarget(smallButton);
    assert.equal(buttonGeometry.visualHeight, 32, "the visible small Button must remain 32px tall");
    assertEffectiveTouchTarget(buttonGeometry, target, "small Button");
    await assertExpandedHitArea(page, smallButton, target, "small Button");

    await navigateToCatalogPage(page, "components/overlays");
    await page.getByRole("button", { name: "Show actionable toast" }).click();
    const coarseToast = await measureToast(page);
    assertGeometryEqual(coarseToast, fineToast, "Toast layout must not change under a coarse pointer");
    const closeButton = page.locator('[data-ui="toast-close"]');
    const closeGeometry = await measureTouchTarget(closeButton);
    assert.equal(closeGeometry.visualHeight, 28, "the visible Toast close button must remain 28px tall");
    assertEffectiveTouchTarget(closeGeometry, target, "Toast close button");
    await assertExpandedHitArea(page, closeButton, target, "Toast close button");
    await dismissToast(page);
  } finally {
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await session.detach();
  }
}

async function assertVisibleTouchTargets(page, target, title) {
  const offenders = await page.evaluate((minimum) => {
    const selector =
      'button:not([disabled]), input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]), textarea:not([disabled]), a[href], [role="menuitem"]:not([aria-disabled="true"]), [role="switch"]:not([disabled])';
    return [...document.querySelectorAll(selector)].flatMap((element) => {
      const rectangle = element.getBoundingClientRect();
      // Form-serialization inputs render at 1×1; nothing at or below that
      // size is a real pointer target.
      if (rectangle.width <= 1 || rectangle.height <= 1) {
        return [];
      }
      const inputArea = element.matches("input") ? element.parentElement?.closest('[data-ui="input-hit-area"]') : null;
      const areaRectangle = inputArea?.getBoundingClientRect();
      const pseudo = getComputedStyle(element, "::after");
      const effectiveWidth = areaRectangle?.width ?? Math.max(rectangle.width, Number.parseFloat(pseudo.width) || 0);
      const effectiveHeight =
        areaRectangle?.height ?? Math.max(rectangle.height, Number.parseFloat(pseudo.height) || 0);
      return effectiveWidth + 0.01 < minimum || effectiveHeight + 0.01 < minimum
        ? [
            `${element.tagName.toLowerCase()}[${element.getAttribute("aria-label") ?? element.textContent?.trim() ?? ""}] ${effectiveWidth}x${effectiveHeight}`,
          ]
        : [];
    });
  }, target);
  assert.deepEqual(offenders, [], `${title} contains undersized coarse-pointer targets: ${offenders.join(", ")}`);
}

async function measureTouchTarget(locator) {
  return locator.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    const pseudo = getComputedStyle(element, "::after");
    return {
      effectiveHeight: Math.max(rectangle.height, Number.parseFloat(pseudo.height) || 0),
      effectiveWidth: Math.max(rectangle.width, Number.parseFloat(pseudo.width) || 0),
      visualHeight: rectangle.height,
      visualWidth: rectangle.width,
    };
  });
}

function assertEffectiveTouchTarget(geometry, target, label) {
  assert.ok(geometry.effectiveHeight >= target, `${label} must expose at least ${String(target)}px of touch height`);
  assert.ok(geometry.effectiveWidth >= target, `${label} must expose at least ${String(target)}px of touch width`);
}

async function assertExpandedHitArea(page, locator, target, label) {
  await locator.scrollIntoViewIfNeeded();
  const point = await locator.evaluate((element, minimum) => {
    const rectangle = element.getBoundingClientRect();
    const expansion = (minimum - rectangle.height) / 2;
    const x = rectangle.left + rectangle.width / 2;
    const y = rectangle.top - Math.min(4, expansion / 2);
    const hit = document.elementFromPoint(x, y);
    return {
      hit: hit?.outerHTML.slice(0, 200) ?? "nothing",
      owned: hit === element || element.contains(hit),
      x,
      y,
    };
  }, target);
  assert.equal(point.owned, true, `${label} must receive hits outside its visible box; hit ${point.hit}`);
  await page.mouse.move(point.x, point.y);
}

async function measureToast(page) {
  const toast = page.locator('[data-ui="toast"]');
  await toast.waitFor({ state: "visible" });
  const content = toast.locator('[data-ui="toast-content"]');
  const close = toast.locator('[data-ui="toast-close"]');
  const [toastBox, contentBox, closeBox] = await Promise.all([
    toast.boundingBox(),
    content.boundingBox(),
    close.boundingBox(),
  ]);
  assert.ok(toastBox !== null && contentBox !== null && closeBox !== null, "the Toast geometry must be measurable");
  return {
    closeHeight: closeBox.height,
    closeWidth: closeBox.width,
    contentHeight: contentBox.height,
    contentWidth: contentBox.width,
    toastHeight: toastBox.height,
    toastWidth: toastBox.width,
  };
}

function assertGeometryEqual(actual, expected, message) {
  for (const key of Object.keys(expected)) {
    assert.ok(Math.abs(actual[key] - expected[key]) <= 0.01, `${message}: ${key} changed`);
  }
}

async function dismissToast(page) {
  const toast = page.locator('[data-ui="toast"]');
  await toast.locator('[data-ui="toast-close"]').click();
  await toast.waitFor({ state: "detached" });
}
