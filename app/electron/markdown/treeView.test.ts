import {test} from "node:test";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {createMarkdownTreeView} = require("./treeView");

const fixture = async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-markdown-tree-view-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await fs.rm(directory, {recursive: true, force: true});
    });
    return {directory, view: createMarkdownTreeView(directory)};
};

test("tree view preserves only the most recent 16 roots and serializes independent view updates", async t => {
    const {directory, view} = await fixture(t);
    for (let index = 0; index < 20; index++) await view.root({path: path.join(directory, String(index)), identity: String(index)});
    const before = await view.read();
    assert.equal(before.roots.length, 16);
    assert.equal(before.roots[0].identity, "19");
    assert.equal(before.roots.at(-1).identity, "4");
    await Promise.all([view.save({width: 400}), view.save({visible: false})]);
    const after = await view.read();
    assert.equal(after.width, 400);
    assert.equal(after.visible, false);
    assert.equal((await view.root({path: before.roots[0].path, identity: "19"})).root.id, before.roots[0].id);
    assert.notEqual((await view.root({path: before.roots[0].path, identity: "replaced"})).root.id, before.roots[0].id);
});

test("unknown, malformed and oversized tree views remain unchanged", async t => {
    const {directory, view} = await fixture(t);
    const file = path.join(directory, "tree-view.json");
    for (const original of ["{broken", JSON.stringify({version: 2, width: 240, visible: true, roots: []}), " ".repeat(1024 * 1024 + 1)]) {
        await fs.writeFile(file, original);
        await assert.rejects(view.read());
        await assert.rejects(view.save({width: 300}));
        await assert.rejects(view.root({path: directory, identity: "1"}));
        assert.equal(await fs.readFile(file, "utf8"), original);
    }
});
