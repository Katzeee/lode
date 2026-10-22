import assert from "node:assert/strict";
import { designSystemTest } from "./support/browser.mjs";

const editorAt = (page, key) => page.locator(`[data-item-key="${key}"] [data-ui="outline-editor"]:focus`);
const rowAt = (page, key) => page.locator(`[data-ui="outline-row"][data-item-key="${key}"]`);
async function edit(page, key) {
  await rowAt(page, key).locator('[data-ui="outline-row-text"]').click();
  await editorAt(page, key).waitFor();
}

designSystemTest(
  "Item structure restrictions leave its content editable and descendant operations available",
  async (page) => {
    await page.evaluate(() => {
      window.location.hash = "#/node-editor-capabilities";
    });
    await edit(page, "root");
    await page.keyboard.press("End");
    await page.keyboard.type(" edited");
    for (const key of ["Enter", "Shift+Enter", "Home", "Enter", "Alt+Shift+d"]) {
      await page.keyboard.press(key);
    }
    await page.keyboard.press("Escape");
    for (const key of ["Tab", "Alt+Shift+ArrowDown", "Delete", "Control+x"]) {
      await page.keyboard.press(key);
    }
    assert.equal(await page.getByLabel("Capability calls").textContent(), "[]");
    assert.equal(await editorAt(page, "root").textContent(), "root edited");
    assert.equal(await page.getByRole("button", { name: "Indent selected nodes" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Create child under locked-leaf" }).count(), 0);
    const bullet = await rowAt(page, "root").locator('[data-ui="outline-bullet"]').boundingBox();
    await page.mouse.move(bullet.x + bullet.width / 2, bullet.y + bullet.height / 2);
    await page.mouse.down();
    await page.mouse.move(bullet.x + 70, bullet.y + 70, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.getByLabel("Capability calls").textContent(), "[]");
    await edit(page, "child-b");
    await page.keyboard.press("End");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await editorAt(page, "created").waitFor();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Delete");
    assert.deepEqual(JSON.parse(await page.getByLabel("Capability calls").textContent()), [
      "move:child-b",
      "after:child-b",
      "remove:created",
    ]);
  },
);

designSystemTest(
  "An async subtree move restores its editor without clearing the remapped node selection",
  async (page) => {
    await page.evaluate(() => {
      window.location.hash = "#/node-editor-move-selection";
    });
    await edit(page, "moving");
    await page.keyboard.press("Escape");
    assert.equal(await rowAt(page, "child").getAttribute("aria-selected"), "true");
    await page.keyboard.press("Tab");
    await editorAt(page, "moved").waitFor();
    assert.equal(await rowAt(page, "moved").getAttribute("aria-selected"), "true");
    assert.equal(await rowAt(page, "moved-child").getAttribute("aria-selected"), "true");
    await page.keyboard.press("Control+z");
    await editorAt(page, "moving").waitFor();
  },
);

for (const destination of ["text", "selection", "outside"]) {
  designSystemTest(`An async subtree move preserves a later ${destination} interaction`, async (page) => {
    await page.evaluate(() => {
      window.location.hash = "#/node-editor-move-selection-delayed";
    });
    await edit(page, "moving");
    await page.keyboard.press("Tab");
    if (destination === "outside") {
      await page.getByLabel("Outside field").fill("outside input");
    } else {
      await edit(page, "other");
      if (destination === "text") {
        await page.keyboard.press("End");
        await page.keyboard.type(" edited");
      } else {
        await page.keyboard.press("Escape");
        assert.equal(await rowAt(page, "other").getAttribute("aria-selected"), "true");
      }
    }
    // Resolve the host operation without generating a new user focus decision.
    await page.getByRole("button", { name: "Release pending move" }).evaluate((element) => element.click());
    await rowAt(page, "moved").waitFor();
    if (destination === "outside") {
      assert.equal(
        await page.getByLabel("Outside field").evaluate((element) => element === document.activeElement),
        true,
      );
    } else if (destination === "text") {
      assert.equal(await editorAt(page, "other").textContent(), "other edited");
    } else {
      assert.equal(await rowAt(page, "other").getAttribute("aria-selected"), "true");
      assert.equal(await rowAt(page, "moved").getAttribute("aria-selected"), "false");
    }
  });
}
