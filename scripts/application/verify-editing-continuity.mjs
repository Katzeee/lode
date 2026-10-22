import { verifyCutPaste } from "./verify-cut-paste.mjs";
import assert from "node:assert/strict";

export async function verifyEditingContinuity(
  page,
  { row, editor, saved, read, write, firstId, field, gammaOccurrence, alphaNodeId },
) {
  const tree = () => page.getByRole("tree", { name: "Workspace nodes" });
  const referencePath = ["mirror-occ", "alpha-reference"];
  const fieldPath = ["mirror-occ", field.fieldOccurrenceId];
  const valuePath = [...fieldPath, "alpha-value-reference"];
  await row(referencePath).locator('[data-ui="outline-row-text"]').click();
  await tree().press("ArrowDown");
  assert.equal(await editor().count(), 0, "navigation into a protected field name keeps object focus");
  await tree().press("ArrowDown");
  assert.equal(await editor().count(), 0, "navigation from a protected name to a reference never renames it");
  assert.equal(await row(valuePath).getAttribute("data-object-focused"), "true");

  await row(["mirror-occ", firstId]).locator('[data-ui="outline-row-text"]').click();
  await editor().press("Escape");
  await editor().press("Delete");
  await row(["mirror-occ", firstId]).waitFor({ state: "detached" });
  await saved();
  assert.equal(await editor().count(), 0, "deleting a preceding node focuses the following reference as an object");
  assert.equal(await row(referencePath).getAttribute("data-object-focused"), "true");
  await tree().press("Control+z");
  await row(["mirror-occ", firstId]).waitFor();
  await saved();

  await row([gammaOccurrence.occurrenceId]).locator('[data-ui="outline-row-text"]').click();
  await editor().press("Alt+Shift+ArrowUp");
  await saved();
  const reordered = (await read("childOccurrences"))["editing-lab"];
  assert.ok(
    reordered.indexOf(gammaOccurrence.occurrenceId) < reordered.indexOf("mirror-occ"),
    "reorder moves the whole sibling before the expanded subtree: " + JSON.stringify(reordered),
  );
  await page.getByRole("textbox", { name: "Edit Gamma", exact: true }).waitFor();
  await row(["mirror-occ"]).locator('[data-ui="outline-row-text"]').click();
  await editor().press("Escape");
  await editor().press("Tab");
  await saved();
  const movedRoot = [gammaOccurrence.occurrenceId, "mirror-occ"];
  const movedValue = [...movedRoot, field.fieldOccurrenceId, "alpha-value-reference"];
  await row(movedValue).waitFor();
  assert.equal(await row(movedRoot).getAttribute("aria-expanded"), "true", "moving a subtree keeps it expanded");
  assert.equal(
    await row(movedValue).getAttribute("aria-selected"),
    "true",
    "asynchronous movement preserves subtree selection",
  );
  assert.equal((await read("occurrences"))["mirror-occ"].parentNodeId, gammaOccurrence.nodeId);
  await editor().press("Control+z");
  await saved();
  await row(valuePath).waitFor();
  assert.equal(
    await row(["mirror-occ"]).getAttribute("aria-expanded"),
    "true",
    "undo restores the same expanded appearance",
  );

  await row(referencePath).locator('[data-ui="outline-row-text"]').click();
  await tree().press("Alt+Shift+ArrowDown");
  await saved();
  assert.equal(await editor().count(), 0, "a focused reference stays sealed when an asynchronous move finishes");
  await tree().evaluate((element) => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    window.continuityClipboard = data;
  });
  await write([
    {
      kind: "node-create",
      nodeId: "paste-host",
      occurrenceId: "paste-host-occ",
      parentNodeId: "editing-lab",
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
      seed: { text: [{ value: "Paste host", attributes: {} }] },
    },
  ]);
  await row(["paste-host-occ"]).getByRole("button", { name: "Activate Paste host" }).click();
  await page.getByRole("heading", { name: "Paste host", exact: true }).waitFor();
  await page.getByRole("button", { name: "Create node", exact: true }).click();
  await editor().evaluate((element) =>
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: window.continuityClipboard, bubbles: true, cancelable: true }),
    ),
  );
  await saved();
  const placements = await read("occurrences");
  const pastedId = (await read("childOccurrences"))["paste-host"][0];
  assert.equal(placements[pastedId].nodeId, alphaNodeId, "copy and paste retain the shared Node identity");
  await row([pastedId]).waitFor();
  assert.equal(await editor().count(), 0, "pasting a reference lands on the object without entering its name editor");
  assert.equal(await row([pastedId]).getAttribute("data-object-focused"), "true");
  await page.reload();
  await page.getByRole("heading", { name: "Paste host", exact: true }).waitFor();
  await row([pastedId]).waitFor();
  assert.equal(
    await row([pastedId]).locator("strong").textContent(),
    "Alpha",
    "reload restores the real referenced content and formatting",
  );
  await verifyCutPaste(page, { row, editor, saved, read, write });
}
