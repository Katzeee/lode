import assert from "node:assert/strict";

/** E02/E09: native text selection and clipboard travel through the actual editor and daemon. */
export async function verifyCommonText(page, client, workspaceId, actorId) {
  const initial =
    "这是用于普通文字编辑的长段落。我们需要在自动换行后继续移动光标，选择文字，替换内容，并保证节点身份保持不变。这是一段延续文本，用于让编辑内容跨越多个显示行。 Alpha 中文🙂 Omega。";
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
    historyChannelId: "common-text-setup",
    intent: "direct",
    actions: [
      node("common-text-lab", workspaceId, "Common text editing"),
      node("common-text-source", "common-text-lab", initial),
      node("common-text-observer", "common-text-lab", "Mirror"),
      node("common-nav-omega", "common-text-lab", "Omega"),
      node("common-nav-alpha", "common-text-lab", "Alpha"),
      {
        kind: "occurrence-create",
        occurrenceId: "common-text-reference",
        nodeId: "common-text-source",
        parentNodeId: "common-text-observer",
        anchor,
      },
    ],
  });
  assert.equal(result.status, "published", JSON.stringify(result));
  const origin = new URL(page.url()).origin;
  await page.bringToFront();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/#/workspace/${workspaceId}/node/common-text-lab`);
  await page.getByRole("heading", { name: "Common text editing", exact: true }).waitFor();
  const row = (id) =>
    page.locator(
      `[data-ui="outline-row"][data-item-key=${JSON.stringify(JSON.stringify(Array.isArray(id) ? id : [id]))}]`,
    );
  const source = row("common-text-source-occ");
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
  const assertStored = async (expected) => {
    await saved();
    assert.equal(
      (await read("nodes"))["common-text-source"].content
        .map((item) => (item.kind === "text" ? item.value : "@"))
        .join(""),
      expected,
    );
    assert.equal((await read("nodeOwners"))["common-text-source"], "common-text-lab");
    assert.deepEqual((await read("childOccurrences"))["common-text-lab"], [
      "common-text-source-occ",
      "common-text-observer-occ",
      "common-nav-omega-occ",
      "common-nav-alpha-occ",
    ]);
    assert.equal(
      await row(["common-text-observer-occ", "common-text-reference"])
        .locator('[data-ui="outline-row-text"]')
        .textContent(),
      expected,
    );
  };
  const selectText = async (needle) => {
    const points = await editor().evaluate((element, needle) => {
      const start = element.textContent.lastIndexOf(needle);
      if (start < 0) {
        throw new Error("Text selection target is absent");
      }
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) {
        texts.push(walker.currentNode);
      }
      const locate = (offset) => {
        for (const text of texts) {
          if (offset < text.textContent.length) {
            return { node: text, offset };
          }
          offset -= text.textContent.length;
        }
        throw new Error("Text offset exceeds source");
      };
      const rectAt = (offset) => {
        const point = locate(offset),
          range = document.createRange();
        range.setStart(point.node, point.offset);
        range.setEnd(point.node, point.offset + 1);
        return range.getBoundingClientRect();
      };
      const first = rectAt(start),
        last = rectAt(start + needle.length - 1);
      return {
        from: { x: first.left + 0.1, y: first.top + first.height / 2 },
        to: { x: last.right - 0.1, y: last.top + last.height / 2 },
      };
    }, needle);
    await page.mouse.move(points.from.x, points.from.y);
    await page.mouse.down();
    await page.mouse.move(points.to.x, points.to.y, { steps: 12 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.getSelection().toString()), needle);
  };
  await row("common-text-observer-occ").getByRole("button", { name: "Expand Mirror", exact: true }).click();
  await source.locator('[data-ui="outline-row-text"]').click({ position: { x: 5, y: 8 } });
  assert.ok(
    await editor().evaluate(
      (element) => element.getBoundingClientRect().height > Number.parseFloat(getComputedStyle(element).lineHeight) * 2,
    ),
    "the text must span several rendered lines",
  );
  const acrossLines = "我们需要在自动换行后继续移动光标，选择文字，替换内容，并保证节点身份保持不变。";
  await selectText(acrossLines);
  await page.keyboard.type("跨行选择也保持正确。");
  await assertStored(initial.replace(acrossLines, "跨行选择也保持正确。"));
  await selectText("跨行选择也保持正确。");
  await page.keyboard.type(acrossLines);
  await assertStored(initial);
  await selectText("中文🙂");
  await page.keyboard.type("替换🚀");
  const replaced = initial.replace("中文🙂", "替换🚀");
  await assertStored(replaced);
  await editor().press("Backspace");
  const erasedEmoji = initial.replace("中文🙂", "替换");
  await assertStored(erasedEmoji);
  await editor().press("Delete");
  const erasedSpace = initial.replace("中文🙂 ", "替换");
  await assertStored(erasedSpace);
  await editor().press("Control+z");
  await assertStored(erasedEmoji);
  await editor().press("Control+Shift+z");
  await assertStored(erasedSpace);
  await selectText("替换");
  await editor().press("Control+c");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "替换");
  await editor().press("Control+x");
  const cut = initial.replace("中文🙂 ", "");
  await assertStored(cut);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "替换");
  await editor().press("Control+v");
  await assertStored(erasedSpace);
  await editor().press("End");
  await editor().pressSequentially("!");
  await assertStored(erasedSpace + "!");
  await page.reload();
  await page.getByRole("heading", { name: "Common text editing", exact: true }).waitFor();
  assert.equal(await source.locator('[data-ui="outline-row-text"]').textContent(), erasedSpace + "!");
  await row("common-nav-omega-occ").locator('[data-ui="outline-row-text"]').click();
  await editor().press("Home");
  await editor().press("ArrowRight");
  await editor().press("ArrowRight");
  await editor().press("ArrowDown");
  assert.equal(await editor().textContent(), "Alpha");
  assert.equal(await editor().evaluate(() => window.getSelection().focusOffset), 0);
  await editor().press("ArrowRight");
  await editor().press("ArrowRight");
  await editor().press("ArrowUp");
  assert.equal(await editor().textContent(), "Omega");
  assert.equal(await editor().evaluate(() => window.getSelection().focusOffset), 0);
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto(`${origin}/#/workspace/${workspaceId}`);
  await page.getByRole("heading", { name: "Shared workspace", exact: true }).waitFor();
}
