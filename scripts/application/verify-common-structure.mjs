import assert from "node:assert/strict";

/** Tana's documented bullet drag uses the same Node identities and subtree as keyboard movement. */
export async function verifyCommonStructure(page, client, workspaceId, actorId) {
  const anchor = { after: null, before: null, affinity: "after", fallback: "end" };
  const node = (nodeId, parentNodeId, value) => ({
    kind: "node-create",
    nodeId,
    parentNodeId,
    occurrenceId: `${nodeId}-occ`,
    anchor,
    seed: { text: [{ value, attributes: {} }] },
  });
  const setup = await client.execute({
    kind: "edit",
    workspaceId,
    actorId,
    invocationId: crypto.randomUUID(),
    historyChannelId: "common-drag-setup",
    intent: "direct",
    actions: [
      { ...node("common-drag", workspaceId, "Common drag"), anchor: { ...anchor, fallback: "start" } },
      node("drag-source", "common-drag", "Moving root"),
      node("drag-child", "drag-source", "Owned child 中文🙂"),
      node("drag-target", "common-drag", "Destination parent"),
      node("drag-sibling", "common-drag", "Following sibling"),
      node("drag-observer", "common-drag", "Observer"),
      {
        kind: "occurrence-create",
        nodeId: "drag-source",
        occurrenceId: "drag-reference",
        parentNodeId: "drag-observer",
        anchor,
      },
    ],
  });
  assert.equal(setup.status, "published", JSON.stringify(setup));
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
  const origin = new URL(page.url()).origin;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${origin}/#/workspace/${workspaceId}/node/common-drag`);
  await page.getByRole("heading", { name: "Common drag", exact: true }).waitFor();
  const row = (path) => page.locator(`[data-ui="outline-row"][data-item-key=${JSON.stringify(JSON.stringify(path))}]`);
  const source = () => row(["drag-source-occ"]);
  const moved = () => row(["drag-target-occ", "drag-source-occ"]);
  const editor = () => page.locator('[data-ui="outline-editor"]:focus');
  const saved = () => page.getByText("Saved locally", { exact: true }).waitFor();
  const initialNodes = await read("nodes");
  const initialOrder = (await read("childOccurrences"))["common-drag"];
  const assertIdentity = async (parentNodeId) => {
    const nodes = await read("nodes"),
      owners = await read("nodeOwners"),
      occurrences = await read("occurrences");
    assert.deepEqual(nodes["drag-source"], initialNodes["drag-source"]);
    assert.deepEqual(nodes["drag-child"], initialNodes["drag-child"]);
    assert.equal(owners["drag-source"], parentNodeId);
    assert.equal(owners["drag-child"], "drag-source");
    assert.equal(occurrences["drag-source-occ"].parentNodeId, parentNodeId);
    assert.equal(occurrences["drag-child-occ"].parentNodeId, "drag-source");
    assert.equal(occurrences["drag-reference"].nodeId, "drag-source");
    assert.equal(occurrences["drag-reference"].parentNodeId, "drag-observer");
    assert.deepEqual((await read("childOccurrences"))["drag-source"], ["drag-child-occ"]);
  };
  const expand = source().getByRole("button", { name: "Expand Moving root", exact: true });
  if (await expand.count()) await expand.click();
  await source().locator('[data-ui="outline-row-text"]').click();
  await editor().press("Escape");
  assert.equal(await row(["drag-source-occ", "drag-child-occ"]).getAttribute("aria-selected"), "true");
  await drag(page, source(), row(["drag-target-occ"]), 1);
  await moved().waitFor();
  await saved();
  await assertIdentity("drag-target");
  assert.equal(await moved().getAttribute("aria-expanded"), "true");
  assert.equal(await moved().getAttribute("aria-selected"), "true");
  assert.equal(
    await row(["drag-target-occ", "drag-source-occ", "drag-child-occ"]).getAttribute("aria-selected"),
    "true",
  );
  assert.deepEqual((await read("childOccurrences"))["drag-target"], ["drag-source-occ"]);
  await page.keyboard.press("Control+z");
  await source().waitFor();
  await saved();
  await assertIdentity("common-drag");
  assert.deepEqual((await read("childOccurrences"))["common-drag"], initialOrder);

  // Collapsing changes the visible rows, not the authored subtree moved by its bullet.
  await source().getByRole("button", { name: "Collapse Moving root", exact: true }).click();
  await source().locator('[data-ui="outline-row-text"]').click();
  await editor().press("Escape");
  await drag(page, source(), row(["drag-sibling-occ"]), 0);
  await page.waitForFunction(() => {
    const source = [...document.querySelectorAll('[data-ui="outline-row"]')].find(
      (row) => row.getAttribute("data-item-key") === '["drag-source-occ"]',
    );
    return source?.getAttribute("aria-posinset") === "3";
  });
  await saved();
  await assertIdentity("common-drag");
  assert.deepEqual((await read("childOccurrences"))["common-drag"], [
    "drag-target-occ",
    "drag-sibling-occ",
    "drag-source-occ",
    "drag-observer-occ",
  ]);
  assert.equal(await source().getAttribute("aria-expanded"), "false");
  assert.equal(await source().getAttribute("aria-selected"), "true");
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => {
    const source = [...document.querySelectorAll('[data-ui="outline-row"]')].find(
      (row) => row.getAttribute("data-item-key") === '["drag-source-occ"]',
    );
    return source?.getAttribute("aria-posinset") === "1";
  });
  await saved();
  await assertIdentity("common-drag");
  assert.deepEqual((await read("childOccurrences"))["common-drag"], initialOrder);
  await source().locator('[data-ui="outline-row-text"]').click();
  await editor().press("Escape");
  await row(["drag-target-occ"]).click({ modifiers: ["Shift"] });
  assert.equal(await source().getAttribute("aria-selected"), "true");
  assert.equal(await row(["drag-target-occ"]).getAttribute("aria-selected"), "true");
  await drag(page, source(), row(["drag-sibling-occ"]), 0);
  await page.waitForFunction(() => {
    const source = [...document.querySelectorAll('[data-ui="outline-row"]')].find(
      (row) => row.getAttribute("data-item-key") === '["drag-source-occ"]',
    );
    return source?.getAttribute("aria-posinset") === "2";
  });
  await saved();
  await assertIdentity("common-drag");
  assert.deepEqual(
    (await read("childOccurrences"))["common-drag"],
    ["drag-sibling-occ", "drag-source-occ", "drag-target-occ", "drag-observer-occ"],
    "dragging a contiguous selection preserves root order and the hidden owned subtree",
  );
  assert.equal(await source().getAttribute("aria-selected"), "true");
  assert.equal(await row(["drag-target-occ"]).getAttribute("aria-selected"), "true");
  assert.equal(await row(["drag-sibling-occ"]).getAttribute("aria-selected"), "false");
  assert.equal(await row(["drag-observer-occ"]).getAttribute("aria-selected"), "false");
  assert.deepEqual((await read("nodes"))["drag-target"], initialNodes["drag-target"]);
  assert.equal((await read("nodeOwners"))["drag-target"], "common-drag");
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => {
    const source = [...document.querySelectorAll('[data-ui="outline-row"]')].find(
      (row) => row.getAttribute("data-item-key") === '["drag-source-occ"]',
    );
    return source?.getAttribute("aria-posinset") === "1";
  });
  await saved();
  await assertIdentity("common-drag");
  assert.deepEqual((await read("childOccurrences"))["common-drag"], initialOrder);

  await source().locator('[data-ui="outline-row-text"]').click();
  await editor().press("Escape");
  await saved();
  const generation = async () => {
    const result = await client.query({
      kind: "projection",
      workspaceId,
      perspective: "origin",
      section: "nodes",
      limit: 1,
    });
    assert.equal(result.status, "ok");
    return result.value.identity.generationId;
  };
  const beforeCancel = await generation();
  await drag(page, source(), row(["drag-target-occ"]), 1, true);
  await saved();
  assert.equal(await generation(), beforeCancel, "Escape cancels the preview without publishing a structural edit");
  assert.equal(
    await source().getAttribute("aria-selected"),
    "true",
    "Escape during drag preserves the existing node selection",
  );
  await assertIdentity("common-drag");
  assert.deepEqual((await read("childOccurrences"))["common-drag"], initialOrder);
  await page.goto(`${origin}/#/workspace/${workspaceId}`);
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).waitFor();
}

async function drag(page, source, target, depthOffset, cancel = false) {
  const [from, to, targetRow] = await Promise.all([
    source.locator('[data-ui="outline-bullet"]').boundingBox(),
    target.locator('[data-ui="outline-bullet"]').boundingBox(),
    target.boundingBox(),
  ]);
  assert.ok(from && to && targetRow, "source and destination bullets are visible");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(to.x + to.width / 2 + 20 * depthOffset, targetRow.y + targetRow.height - 2, { steps: 8 });
    await page.locator('[data-ui="outline-drop-indicator"] > div').waitFor({ state: "visible" });
    if (cancel) {
      await page.keyboard.press("Escape");
      await page.locator('[data-ui="outline-drop-indicator"]').waitFor({ state: "detached" });
    }
  } finally {
    await page.mouse.up();
  }
}
