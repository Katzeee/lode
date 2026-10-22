import assert from "node:assert/strict";

export async function verifyOrdinaryBoundaries(page, client, workspaceId, actorId, node, read) {
  const created = await client.execute({
    kind: "edit",
    workspaceId,
    actorId,
    invocationId: crypto.randomUUID(),
    historyChannelId: "ordinary-boundaries-setup",
    intent: "direct",
    actions: [
      node("ordinary-paste", "ordinary-lab", "Paste boundaries"),
      node("ordinary-caret", "ordinary-paste", "AlphaOmega"),
      node("ordinary-range", "ordinary-paste", "Alpha middle Omega"),
      node("ordinary-title", "ordinary-lab", "TitleProbe"),
      node("ordinary-title-child", "ordinary-title", "ChildProbe"),
      node("ordinary-title-sibling", "ordinary-title", "SiblingProbe"),
    ],
  });
  assert.equal(created.status, "published", JSON.stringify(created));
  const origin = new URL(page.url()).origin;
  const editor = () => page.locator('[data-ui="outline-editor"]:focus');
  const saved = () => page.getByText("Saved locally", { exact: true }).waitFor();
  const text = (nodes, id) => nodes[id].content.map((item) => (item.kind === "text" ? item.value : "")).join("");
  await page.goto(`${origin}/#/workspace/${workspaceId}/node/ordinary-paste`);
  for (const [id, label, start, selected] of [
    ["ordinary-caret", "AlphaOmega", 5, 0],
    ["ordinary-range", "Alpha middle Omega", 6, 6],
  ]) {
    await page.locator('[data-ui="outline-row-text"]').filter({ hasText: label }).click();
    await editor().press("Home");
    for (let index = 0; index < start; index += 1) await editor().press("ArrowRight");
    for (let index = 0; index < selected; index += 1) await editor().press("Shift+ArrowRight");
    await editor().evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text/plain", "One\nTwo");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await saved();
    assert.equal(await editor().textContent(), "Two");
    assert.equal(
      await editor().evaluate((element) => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.setEnd(selection.focusNode, selection.focusOffset);
        return range.toString().length;
      }),
      3,
      "multiline block paste focuses the end of its last root Node",
    );
    const nodes = await read("nodes"),
      occurrences = await read("occurrences");
    const children = (await read("childOccurrences"))["ordinary-paste"];
    const at = children.indexOf(`${id}-occ`);
    assert.equal(
      text(nodes, id),
      label,
      "Tana keeps the source row intact for both caret and text selection block paste",
    );
    assert.deepEqual(
      children.slice(at + 1, at + 3).map((occurrenceId) => text(nodes, occurrences[occurrenceId].nodeId)),
      ["One", "Two"],
    );
  }
  await page.goto(`${origin}/#/workspace/${workspaceId}/node/ordinary-title`);
  await page.locator('[data-ui="outline-row-text"]').filter({ hasText: "ChildProbe" }).click();
  await editor().press("Home");
  await editor().press("Backspace");
  assert.equal(await editor().textContent(), "TitleProbeChildProbe");
  assert.equal(await editor().evaluate((element) => element.closest('[data-ui="outline-title"]') !== null), true);
  await editor().pressSequentially("!");
  await saved();
  assert.equal(
    text(await read("nodes"), "ordinary-title"),
    "TitleProbe!ChildProbe",
    "typing continues on the parent identity at the merge connection point",
  );
  assert.deepEqual((await read("childOccurrences"))["ordinary-title"], ["ordinary-title-sibling-occ"]);
  const system = await read("workspaceSystemNodes");
  assert.equal((await read("nodeOwners"))["ordinary-title-child"], system.trash);
  await editor().press("Control+z");
  await saved();
  await editor().press("Control+z");
  await saved();
  assert.equal(text(await read("nodes"), "ordinary-title"), "TitleProbe");
  assert.deepEqual((await read("childOccurrences"))["ordinary-title"], [
    "ordinary-title-child-occ",
    "ordinary-title-sibling-occ",
  ]);
  await page.locator('[data-ui="outline-row-text"]').filter({ hasText: "ChildProbe" }).click();
  await editor().press("End");
  await editor().pressSequentially(" restored");
  await saved();
  assert.equal(text(await read("nodes"), "ordinary-title-child"), "ChildProbe restored");
}
