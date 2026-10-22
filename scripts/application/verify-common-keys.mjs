import assert from "node:assert/strict";

export async function verifyCommonKeys(page, client, workspaceId, actorId) {
  const anchor = { after: null, before: null, affinity: "after", fallback: "end" };
  const node = (nodeId, parentNodeId, value) => ({
    kind: "node-create",
    nodeId,
    occurrenceId: `${nodeId}-occ`,
    parentNodeId,
    anchor,
    seed: { text: [{ value, attributes: {} }] },
  });
  const result = await client.execute({
    kind: "edit",
    workspaceId,
    actorId,
    invocationId: crypto.randomUUID(),
    historyChannelId: "common-keys-setup",
    intent: "direct",
    actions: [
      node("common-keys", workspaceId, "Common keys"),
      node("keys-parent", "common-keys", "Alpha"),
      node("keys-child", "keys-parent", "Nested"),
      node("keys-left", "common-keys", "X"),
      node("keys-right", "common-keys", "Omega"),
    ],
  });
  assert.equal(result.status, "published", JSON.stringify(result));
  const origin = new URL(page.url()).origin;
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto(`${origin}/#/workspace/${workspaceId}/node/common-keys`);
  await page.getByRole("heading", { name: "Common keys", exact: true }).waitFor();
  const row = (id) => page.locator(`[data-ui="outline-row"][data-item-key=${JSON.stringify(JSON.stringify([id]))}]`);
  const editor = () => page.locator('[data-ui="outline-editor"]:focus');
  const saved = () => page.getByText("Saved locally", { exact: true }).waitFor();
  const read = async (section) => {
    const values = {};
    let after;
    do {
      const result = await client.query({
        kind: "projection",
        workspaceId,
        perspective: "origin",
        section,
        limit: 100,
        ...(after ? { after } : {}),
      });
      assert.equal(result.status, "ok");
      Object.assign(values, result.value[section]);
      after = result.value.next;
    } while (after);
    return values;
  };
  const text = (node) => node.content.map((item) => (item.kind === "text" ? item.value : "@")).join("");
  const parent = row("keys-parent-occ");
  await parent.locator('[data-ui="outline-row-text"]').click();
  await editor().press("Home");
  await editor().press("Enter");
  await page.keyboard.type("Before");
  await saved();
  const beforeOrder = (await read("childOccurrences"))["common-keys"];
  assert.equal(beforeOrder.indexOf("keys-parent-occ"), 1);
  assert.equal(text((await read("nodes"))[(await read("occurrences"))[beforeOrder[0]].nodeId]), "Before");
  assert.equal(text((await read("nodes"))["keys-parent"]), "Alpha");

  await parent.locator('[data-ui="outline-row-text"]').click();
  assert.equal(await parent.getAttribute("aria-expanded"), "false");
  await editor().press("End");
  await editor().press("Enter");
  await page.keyboard.type("After");
  await saved();
  const afterOrder = (await read("childOccurrences"))["common-keys"];
  assert.equal(text((await read("nodes"))[(await read("occurrences"))[afterOrder[2]].nodeId]), "After");
  assert.deepEqual((await read("childOccurrences"))["keys-parent"], ["keys-child-occ"]);

  await parent.locator('[data-ui="outline-row-text"]').click();
  await editor().press("Home");
  await editor().press("ArrowRight");
  await editor().press("ArrowRight");
  await editor().press("Shift+ArrowRight");
  await editor().press("Shift+ArrowRight");
  assert.equal(await page.evaluate(() => window.getSelection().toString()), "ph");
  await editor().press("Enter");
  await saved();
  assert.equal(await editor().textContent(), "a");
  await editor().pressSequentially("!");
  await saved();
  assert.equal(await editor().textContent(), "!a");
  assert.equal(text((await read("nodes"))["keys-parent"]), "Al");
  assert.deepEqual((await read("childOccurrences"))["keys-parent"], ["keys-child-occ"]);
  assert.equal((await read("nodeOwners"))["keys-child"], "keys-parent");
  await editor().press("Control+z");
  await saved();
  await editor().press("Control+z");
  await saved();
  assert.equal(text((await read("nodes"))["keys-parent"]), "Alpha");
  assert.deepEqual((await read("childOccurrences"))["common-keys"], afterOrder);

  await row("keys-left-occ").locator('[data-ui="outline-row-text"]').click();
  await editor().press("End");
  await editor().press("Delete");
  await page.keyboard.type("!");
  await saved();
  assert.equal(await editor().textContent(), "X!Omega");
  assert.equal(text((await read("nodes"))["keys-left"]), "X!Omega");
  const systems = await client.query({
    kind: "projection",
    workspaceId,
    perspective: "origin",
    section: "workspaceSystemNodes",
    limit: 100,
  });
  assert.equal(systems.status, "ok");
  assert.equal((await read("nodeOwners"))["keys-right"], systems.value.workspaceSystemNodes.trash);
  await editor().press("Control+z");
  await saved();
  await editor().press("Control+z");
  await saved();
  assert.equal(text((await read("nodes"))["keys-left"]), "X");
  assert.equal(text((await read("nodes"))["keys-right"]), "Omega");
  assert.deepEqual((await read("childOccurrences"))["common-keys"], afterOrder);
  await page.goto(`${origin}/#/workspace/${workspaceId}`);
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).waitFor();
}
