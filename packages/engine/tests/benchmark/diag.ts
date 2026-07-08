/**
 * Diagnostic micro-benchmark: isolate exactly which Loro operation is slow.
 * Run: node_modules/.bin/tsx tests/benchmark/diag.ts
 */
import { LoroDoc, LoroText } from "loro-crdt";
import { Engine } from "../../src/core/engine.js";
import { ShardedBlockStore } from "../../src/core/store/sharded-store.js";

const t = (label: string, fn: () => void) => {
  const t0 = performance.now();
  fn();
  console.log(`  ${label.padEnd(48)} ${(performance.now() - t0).toFixed(1).padStart(8)} ms`);
};

console.log("\n═══ Loro raw ops ═══════════════════════════════════════════════════");

// 1. Raw LoroDoc — does the WASM module itself start fast?
t("new LoroDoc()", () => {
  new LoroDoc();
});

// 2. LoroTree bulk create via raw API
{
  const doc = new LoroDoc();
  const tree = doc.getTree("blocks");
  t("LoroTree.createNode() × 500 (no commit)", () => {
    for (let i = 0; i < 500; i++) {
      tree.createNode(undefined, i);
    }
  });
}
{
  const doc = new LoroDoc();
  const tree = doc.getTree("blocks");
  t("LoroTree.createNode() × 500 + 1 commit", () => {
    for (let i = 0; i < 500; i++) {
      tree.createNode(undefined, i);
    }
    doc.commit();
  });
}
{
  const doc = new LoroDoc();
  const tree = doc.getTree("blocks");
  t("LoroTree.createNode() × 500 each committed", () => {
    for (let i = 0; i < 500; i++) {
      tree.createNode(undefined, i);
      doc.commit();
    }
  });
}

// 3. LoroText inserts
{
  const doc = new LoroDoc();
  const text = doc.getText("t");
  const str = "a".repeat(500);
  t("LoroText.insert() × 500 chars (1 at a time, 1 commit)", () => {
    for (let i = 0; i < 500; i++) {
      text.insert(i, str[i]);
    }
    doc.commit();
  });
}
{
  const doc = new LoroDoc();
  const text = doc.getText("t");
  t("LoroText.insert() × 500 chars (each committed)", () => {
    for (let i = 0; i < 500; i++) {
      text.insert(i, "a");
      doc.commit();
    }
  });
}
{
  const doc = new LoroDoc();
  const text = doc.getText("t");
  t("LoroText.insert('aaa...500 chars', 0) (bulk, 1 commit)", () => {
    text.insert(0, "a".repeat(500));
    doc.commit();
  });
}

// 4. LoroTree + LoroText per node
{
  const doc = new LoroDoc();
  const tree = doc.getTree("blocks");
  t("500 nodes + 80-char text per node, single commit", () => {
    for (let i = 0; i < 500; i++) {
      const node = tree.createNode(undefined, i);
      const lt = node.data.setContainer("content", new LoroText());
      lt.insert(0, `hello world from block number ${i} in the outliner document test run abc`);
    }
    doc.commit();
  });
}
{
  const doc = new LoroDoc();
  const tree = doc.getTree("blocks");
  t("500 nodes + 80-char text per node, commit per node", () => {
    for (let i = 0; i < 500; i++) {
      const node = tree.createNode(undefined, i);
      const lt = node.data.setContainer("content", new LoroText());
      lt.insert(0, `hello world from block number ${i} in the outliner document test run abc`);
      doc.commit();
    }
  });
}

console.log("\n═══ Engine API ═════════════════════════════════════════════════");

// 5. Engine — our wrapper
{
  const doc = new Engine();
  t("Engine.createNode() × 100, individual commits", () => {
    for (let i = 0; i < 100; i++) {
      doc.createNode();
    }
  });
}
{
  const doc = new Engine();
  const ids: string[] = [];
  t("Engine.createNode() × 100 in transact()", () => {
    doc.transact(() => {
      for (let i = 0; i < 100; i++) {
        ids.push(doc.createNode().occurrenceId);
      }
    });
  });
  t("Engine.replaceDeltas() × 100 in transact()", () => {
    doc.transact(() => {
      for (const id of ids) {
        doc.replaceDeltas(id, [
          { insert: "hello world from block in the outliner document test abc" },
        ]);
      }
    });
  });
  t("Engine.export() after 100 blocks", () => {
    doc.exportSnapshot();
  });
  t("new Engine({ initialTreeBytes }) — import 100 blocks (treeDoc structure)", () => {
    new Engine({ store: new ShardedBlockStore({ initialTreeBytes: doc.exportSnapshot() }) });
  });
}
{
  const doc = new Engine();
  const ids: string[] = [];
  t("Engine: 500 blocks + text, all in one transact()", () => {
    doc.transact(() => {
      for (let i = 0; i < 500; i++) {
        const id = doc.createNode().occurrenceId;
        ids.push(id);
        doc.replaceDeltas(id, [
          { insert: `hello world from block number ${i} in the outliner doc` },
        ]);
      }
    });
  });
  const snap = doc.exportSnapshot();
  console.log(
    `  ${"Engine: 500 blocks snapshot size".padEnd(48)} ${(snap.length / 1024).toFixed(1).padStart(8)} KB`,
  );
  t("new Engine({ initialTreeBytes }) — import 500 blocks (treeDoc structure)", () => {
    new Engine({ store: new ShardedBlockStore({ initialTreeBytes: snap }) });
  });
}

console.log();
