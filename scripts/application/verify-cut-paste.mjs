import assert from "node:assert/strict";

export async function verifyCutPaste(page, { row, editor, saved, read, write }) {
  const end = { after: null, before: null, affinity: "after", fallback: "end" };
  await write([
    { kind: "node-create", nodeId: "cut-slot", occurrenceId: "cut-slot-occ", parentNodeId: "editing-lab", anchor: end },
    {
      kind: "node-create",
      nodeId: "cut-parent",
      occurrenceId: "cut-parent-occ",
      parentNodeId: "paste-host",
      anchor: end,
      seed: { text: [{ value: "Cut parent", attributes: {} }] },
    },
    {
      kind: "node-create",
      nodeId: "cut-child",
      occurrenceId: "cut-child-occ",
      parentNodeId: "cut-parent",
      anchor: end,
      seed: { text: [{ value: "Owned child", attributes: {} }] },
    },
    {
      kind: "node-create",
      nodeId: "cut-observer",
      occurrenceId: "cut-observer-occ",
      parentNodeId: "editing-lab",
      anchor: end,
    },
    {
      kind: "occurrence-create",
      nodeId: "cut-parent",
      occurrenceId: "cut-reference",
      parentNodeId: "cut-observer",
      anchor: end,
    },
  ]);
  await row(["cut-parent-occ"]).locator('[data-ui="outline-row-text"]').click();
  await editor().evaluate((element) => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent("cut", { clipboardData: data, bubbles: true, cancelable: true }));
    window.cutPasteClipboard = data;
  });
  await row(["cut-parent-occ"]).waitFor({ state: "detached" });
  await saved();
  assert.equal((await read("nodeOwners"))["cut-parent"], (await read("workspaceSystemNodes")).trash);
  assert.equal((await read("occurrences"))["cut-reference"].nodeId, "cut-parent");
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "Shared workspace" }).click();
  await row(["editing-lab-occ"]).getByRole("button", { name: "Activate Editor baseline" }).click();
  await page.getByRole("heading", { name: "Editor baseline", exact: true }).waitFor();
  await row(["cut-observer-occ"])
    .getByRole("button", { name: /^Expand / })
    .click();
  await page.getByLabel("The referenced node is in the trash", { exact: true }).waitFor();
  await row(["cut-slot-occ"]).locator('[data-ui="outline-row-text"]').click();
  await editor().evaluate((element) =>
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: window.cutPasteClipboard, bubbles: true, cancelable: true }),
    ),
  );
  await row(["cut-parent-occ"]).waitFor();
  await saved();
  assert.equal((await read("nodeOwners"))["cut-parent"], "editing-lab");
  assert.equal(await page.getByLabel("The referenced node is in the trash", { exact: true }).count(), 0);
  assert.equal((await read("occurrences"))["cut-parent-occ"].parentNodeId, "editing-lab");
  assert.deepEqual((await read("childOccurrences"))["cut-parent"], ["cut-child-occ"]);
  assert.equal((await read("occurrences"))["cut-reference"].nodeId, "cut-parent");
  await page.keyboard.press("Control+z");
  await saved();
  assert.equal((await read("nodeOwners"))["cut-parent"], (await read("workspaceSystemNodes")).trash);
  await page.keyboard.press("Control+z");
  await saved();
  assert.equal((await read("nodeOwners"))["cut-parent"], "paste-host");
  assert.equal((await read("occurrences"))["cut-parent-occ"].parentNodeId, "paste-host");
}
