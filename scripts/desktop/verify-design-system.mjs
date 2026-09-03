import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron } from "playwright-core";

import { catalogPages } from "../../packages/design-system-catalog/dist/index.js";
import { tokens } from "../../packages/design-tokens/dist/index.js";
import { verifyCatalogAccessibility } from "./catalog-accessibility.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..", "..");
const documentPath = join(repositoryRoot, "apps", "desktop", "dist", "index.html");
const harnessPath = join(scriptDirectory, "design-system-harness.cjs");
const application = await _electron.launch({ args: [harnessPath, documentPath], cwd: repositoryRoot });

// Representative window sizes from the smallest supported phone through
// tablets in both orientations up to a full desktop. The catalog must fit
// every one of them without horizontal overflow, and the app shell must pick
// the navigation tier its container width mandates.
const deviceViewports = [
  { label: "folded phone (320×568)", width: 320, height: 568 },
  { label: "phone (360×800)", width: 360, height: 800 },
  { label: "large phone (390×844)", width: 390, height: 844 },
  { label: "phone landscape (844×390)", width: 844, height: 390 },
  { label: "tablet portrait (768×1024)", width: 768, height: 1024 },
  { label: "tablet landscape (1024×768)", width: 1024, height: 768 },
  { label: "small laptop (1280×800)", width: 1280, height: 800 },
  { label: "laptop (1366×768)", width: 1366, height: 768 },
  { label: "desktop (1920×1080)", width: 1920, height: 1080 },
];

try {
  const page = await application.firstWindow({ timeout: 30_000 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await verifyCatalogAccessibility(page);
  await page.setViewportSize({ height: 844, width: 390 });
  await verifyCatalogAccessibility(page);
  await verifyDeviceViewports(page);
  await verifyOverlaysAtShortViewport(page);
  await verifyCatalogDrawer(page);
  await page.setViewportSize({ height: 900, width: 1000 });
  await verifyResponsivePatterns(page);
  await verifyCoarsePointerBehavior(page);
  process.stdout.write(
    `Verified ${catalogPages.length} accessible catalog pages across ${String(deviceViewports.length)} device viewports, the responsive layout tiers, the compact navigation drawer, short-viewport overlays, and coarse-pointer touch targets.\n`,
  );
} finally {
  await application.close();
}

async function verifyDeviceViewports(page) {
  for (const viewport of deviceViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    for (const catalogPage of catalogPages) {
      await navigateToCatalogPage(page, catalogPage.path);
      const measurement = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        offenders: [...document.querySelectorAll("body *")]
          .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .slice(0, 3)
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}.${element.className}:${element.textContent?.trim().slice(0, 40) ?? ""}`,
          ),
      }));
      assert.ok(
        measurement.overflow <= 1,
        `${catalogPage.title} overflows the ${viewport.label} viewport by ${String(measurement.overflow)}px: ${measurement.offenders.join(", ")}`,
      );
    }
    await verifyShellTier(page, viewport);
  }
}

async function verifyShellTier(page, viewport) {
  await navigateToCatalogPage(page, "templates/product");
  await page.locator('[data-ui="app-shell"]').first().waitFor({ state: "visible" });
  // The product template nests the previewed product shell inside the
  // catalog's own shell; each one must pick the tier its container mandates.
  const shells = await page.evaluate(() =>
    [...document.querySelectorAll('[data-ui="app-shell"]')].map((element) => ({
      visible: [...element.querySelectorAll("[data-layout]")]
        .filter((candidate) => candidate.closest('[data-ui="app-shell"]') === element)
        .filter((candidate) => candidate.checkVisibility())
        .map((candidate) => candidate.dataset.layout),
      width: element.getBoundingClientRect().width,
    })),
  );
  assert.equal(shells.length, 2, `the product template must render the catalog shell and the previewed shell`);
  const { expanded, medium } = tokens.layout.breakpoint;
  for (const shell of shells) {
    const expectedTier = shell.width >= expanded ? "expanded" : shell.width >= medium ? "medium" : "compact";
    assert.deepEqual(
      shell.visible,
      [expectedTier],
      `the ${viewport.label} viewport must show only the ${expectedTier} navigation tier for a ${String(Math.round(shell.width))}px shell container`,
    );
  }
}

async function verifyOverlaysAtShortViewport(page) {
  const viewport = deviceViewports.find((candidate) => candidate.label.startsWith("phone landscape"));
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

async function verifyCatalogDrawer(page) {
  await page.setViewportSize({ height: 844, width: 390 });
  await navigateToCatalogPage(page, "");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Lode Design System navigation" });
  await drawer.waitFor({ state: "visible" });
  await drawer.getByRole("link", { name: "Buttons" }).click();
  await drawer.waitFor({ state: "detached" });
  await page.locator("main h1").first().waitFor({ state: "visible" });
  assert.equal(
    await page.locator("main h1").first().textContent(),
    "Buttons",
    "selecting a drawer destination must navigate and close the drawer",
  );
}

function assertWithinViewport(box, viewport, label) {
  const fits =
    box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
  assert.ok(
    fits,
    `${label} must fit inside the ${viewport.label} viewport; got ${String(Math.round(box.width))}×${String(Math.round(box.height))} at (${String(Math.round(box.x))}, ${String(Math.round(box.y))})`,
  );
}

async function verifyResponsivePatterns(page) {
  await page.evaluate(() => {
    window.location.hash = "#/design-system/templates/product";
  });
  const shell = page.locator('main [data-ui="app-shell"]');
  await shell.waitFor({ state: "visible" });
  for (const [width, expected] of [
    [500, "compact"],
    [700, "medium"],
    [900, "expanded"],
  ]) {
    await shell.evaluate((element, nextWidth) => {
      element.style.width = `${nextWidth}px`;
    }, width);
    await shell.locator(`[data-layout="${expected}"]`).waitFor({ state: "visible" });
    const visibleTiers = await shell.locator("[data-layout]:visible").count();
    assert.equal(visibleTiers, 1, `${String(width)}px must expose only the ${expected} navigation tier`);
  }

  await page.evaluate(() => {
    window.location.hash = "#/design-system/templates/layouts";
  });
  const pattern = page.locator('[data-ui="list-detail"]');
  await pattern.waitFor({ state: "visible" });
  await pattern.evaluate((element) => {
    element.style.width = "500px";
  });
  await pattern.locator('[data-pane="list"]').waitFor({ state: "visible" });
  assert.equal(await pattern.locator('[data-pane="detail"]').isVisible(), false);
  await pattern.getByRole("button", { name: /Field notes/u }).click();
  await pattern.locator('[data-pane="detail"]').waitFor({ state: "visible" });
  assert.equal(await pattern.locator('[data-pane="list"]').isVisible(), false);
  await pattern.getByRole("button", { name: "← Back to list" }).click();
  await pattern.locator('[data-pane="list"]').waitFor({ state: "visible" });
  await pattern.evaluate((element) => {
    element.style.width = "900px";
  });
  await pattern.locator('[data-pane="detail"]').waitFor({ state: "visible" });
  assert.equal(await pattern.locator('[data-pane="list"]').isVisible(), true);
}

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

async function navigateToCatalogPage(page, path) {
  await page.evaluate(
    (hash) => {
      window.location.hash = hash;
    },
    path === "" ? "#/design-system" : `#/design-system/${path}`,
  );
  await page.locator("main h1").first().waitFor({ state: "visible" });
}

async function assertVisibleTouchTargets(page, target, title) {
  const offenders = await page.evaluate((minimum) => {
    const selector =
      'button:not([disabled]), input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]), textarea:not([disabled]), a[href], [role="menuitem"]:not([aria-disabled="true"]), [role="switch"]:not([disabled])';
    return [...document.querySelectorAll(selector)].flatMap((element) => {
      const rectangle = element.getBoundingClientRect();
      if (rectangle.width === 0 || rectangle.height === 0) {
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
