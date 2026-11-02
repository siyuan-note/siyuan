import {test} from "node:test";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {EventEmitter} = require("node:events");
const {MarkdownTree} = require("./tree");
const {createMarkdownTreeView} = require("./treeView");

const fixture = async (t, options = {}) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-markdown-tree-"));
    const root = path.join(directory, "documents");
    const config = path.join(directory, "config");
    await fs.mkdir(root);
    const tree = new MarkdownTree({view: createMarkdownTreeView(config), ...options});
    t.after(async () => {
        tree.close();
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await fs.rm(directory, {recursive: true, force: true, maxRetries: 3});
    });
    await tree.setRoot(root);
    const location = (nodeId?: string) => ({rootId: tree.root.id, generation: tree.generation, nodeId: nodeId || tree.root.id});
    return {directory, root, config, tree, location};
};

test("tree lists real directories and Markdown lazily with natural ordering and opaque IDs", async t => {
    const {root, tree, location} = await fixture(t);
    await Promise.all(["Folder10", "folder2"].map(name => fs.mkdir(path.join(root, name))));
    await Promise.all(["note10.md", "Note2.MARKDOWN", "skip.txt", "image.png"].map(name => fs.writeFile(path.join(root, name), "content")));
    await fs.writeFile(path.join(root, "folder2", "child.md"), "child");
    const result = await tree.list(location());
    assert.equal(result.kind, "listed");
    assert.deepEqual(result.entries.map(entry => entry.name), ["folder2", "Folder10", "Note2.MARKDOWN", "note10.md"]);
    assert.equal(tree.nodes.size, 5);
    assert.equal(JSON.stringify(result).includes(root), false);
    const child = await tree.list(location(result.entries[0].id));
    assert.deepEqual(child.entries.map(entry => entry.name), ["child.md"]);
    assert.equal((await tree.list(location(result.entries[0].id))).kind, "listed");
    const state = await tree.state(path.join(root, "folder2", "child.md"));
    assert.deepEqual(state.currentPath, [tree.root.id, result.entries[0].id]);
    assert.equal(state.currentNodeId, child.entries[0].id);
    await assert.rejects(tree.file({...location(), nodeId: "../skip.txt"}));
    assert.equal((await tree.list({...location(), generation: 0})).kind, "blocked");
});

test("tree view remembers width, visibility and expanded directories with stable IDs", async t => {
    const {root, config, tree, location} = await fixture(t);
    await fs.mkdir(path.join(root, "child"));
    const child = (await tree.list(location())).entries[0];
    await tree.saveView({...location(), expanded: []}).then(() => assert.fail("nodeId is not a view field"), () => undefined);
    await tree.saveView({rootId: tree.root.id, generation: tree.generation, expanded: [tree.root.id, child.id], width: 310, visible: false});
    const reopened = new MarkdownTree({view: createMarkdownTreeView(config)});
    t.after(() => reopened.close());
    await reopened.setRoot(root);
    const state = await reopened.state();
    assert.equal(state.rootId, tree.root.id);
    assert.deepEqual(state.expanded, [tree.root.id, child.id]);
    assert.equal(state.width, 310);
    assert.equal(state.visible, false);
    await assert.rejects(tree.saveView({width: 481}));
    await assert.rejects(tree.saveView({rootId: tree.root.id, generation: 0, expanded: []}));
    await assert.rejects(tree.saveView({rootId: tree.root.id, generation: tree.generation, expanded: ["foreign"]}));
    await assert.rejects(tree.saveView({rootId: tree.root.id, generation: tree.generation, expanded: Array(257).fill(tree.root.id)}));
});

test("tree root selection preserves manual roots and rejects replaced identities and old locations", async t => {
    const {directory, root, tree, location} = await fixture(t);
    await fs.writeFile(path.join(root, "first.md"), "first");
    const old = location();
    const other = path.join(directory, "other");
    await fs.mkdir(other);
    await tree.setRoot(other);
    const state = await tree.state(path.join(root, "first.md"));
    assert.equal(state.rootName, "other");
    assert.equal(state.currentNodeId, undefined);
    assert.equal(state.generation, 2);
    assert.equal((await tree.list(old)).kind, "blocked");
    await fs.rename(other, other + "-old");
    await fs.mkdir(other);
    assert.equal((await tree.state()).error.code, "identity-changed");
});

test("directory links cannot escape the root or create an ancestor cycle", async t => {
    const {directory, root, tree, location} = await fixture(t);
    const outside = path.join(directory, "outside");
    const child = path.join(root, "child");
    await fs.mkdir(outside);
    await fs.mkdir(child);
    await fs.writeFile(path.join(outside, "secret.md"), "secret");
    await fs.writeFile(path.join(child, "allowed.md"), "allowed");
    await fs.symlink(outside, path.join(root, "escape"), "junction");
    await fs.symlink(root, path.join(root, "cycle"), "junction");
    await fs.symlink(child, path.join(root, "alias"), "junction");
    const result = await tree.list(location());
    assert.deepEqual(result.entries.map(item => item.name), ["alias", "child"]);
    const alias = result.entries[0];
    assert.deepEqual((await tree.list(location(alias.id))).entries.map(item => item.name), ["allowed.md"]);
    await fs.unlink(path.join(root, "alias"));
    await fs.symlink(outside, path.join(root, "alias"), "junction");
    assert.equal((await tree.list(location(alias.id))).kind, "blocked");
});

test("directory and root node limits reject the whole listing without silent truncation", async t => {
    let oversized = false;
    const fake = Object.create(fs);
    fake.opendir = async selection => {
        if (!oversized) return fs.opendir(selection);
        return {async *[Symbol.asyncIterator]() {
            for (let index = 0; index < 10001; index++) yield {name: index + ".txt", isDirectory: () => false, isSymbolicLink: () => false};
        }, async close() {}};
    };
    const {root, tree, location} = await fixture(t, {fileSystem: fake});
    oversized = true;
    assert.equal((await tree.list(location())).error.code, "size");
    assert.equal(tree.nodes.size, 1);
    oversized = false;
    await fs.writeFile(path.join(root, "extra.md"), "extra");
    for (let index = 1; index < 10000; index++) tree.nodes.set("fake" + index, {});
    assert.equal((await tree.list(location())).error.code, "size");
    assert.equal(tree.nodes.size, 10000);
});

test("tree refuses more than 64 nested levels", async t => {
    const {root, tree} = await fixture(t);
    const relative = Array(65).fill("d").join(path.sep);
    await fs.mkdir(path.join(root, relative), {recursive: true});
    await assert.rejects(tree.resolve(relative), error => error.markdownCode === "size");
    assert.equal((await tree.resolve(Array(64).fill("d").join(path.sep))).kind, "directory");
});

test("watchers cover expanded directories, refresh on changes and stop after close", async t => {
    const watched = new Map();
    let notifications = 0;
    const {root, tree, location} = await fixture(t, {notify: () => notifications++, watchDirectory: (selection, callback) => {
        const watcher = new EventEmitter();
        watcher.close = () => { watched.delete(selection); };
        watched.set(selection, callback);
        return watcher;
    }});
    await fs.mkdir(path.join(root, "child"));
    const child = (await tree.list(location())).entries[0];
    await tree.saveView({rootId: tree.root.id, generation: tree.generation, expanded: [child.id]});
    assert.equal(watched.size, 2);
    watched.get(path.join(root, "child"))();
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(notifications, 1);
    tree.close();
    assert.equal(watched.size, 0);
});

test("refresh prunes removed directories and stale descendant grants without removing the listed directory", async t => {
    const {root, tree, location} = await fixture(t);
    const child = path.join(root, "child");
    await fs.mkdir(child);
    await fs.writeFile(path.join(child, "first.md"), "first");
    const folder = (await tree.list(location())).entries[0];
    const file = (await tree.list(location(folder.id))).entries[0];
    await fs.unlink(path.join(child, "first.md"));
    assert.deepEqual((await tree.list(location(folder.id))).entries, []);
    assert.equal(tree.nodes.has(folder.id), true);
    assert.equal(tree.nodes.has(file.id), false);
    await fs.rmdir(child);
    assert.deepEqual((await tree.list(location())).entries, []);
    assert.equal(tree.nodes.size, 1);
});

test("an old in-flight listing cannot replace the newly selected root", async t => {
    let release;
    let started;
    let delayed = false;
    const waiting = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { started = resolve; });
    const fake = Object.create(fs);
    fake.opendir = async selection => {
        const handle = await fs.opendir(selection);
        if (delayed) { started(); await waiting; }
        return handle;
    };
    const {directory, root, tree, location} = await fixture(t, {fileSystem: fake});
    await fs.writeFile(path.join(root, "first.md"), "first");
    const other = path.join(directory, "other");
    await fs.mkdir(other);
    delayed = true;
    const listing = tree.list(location());
    await ready;
    await tree.setRoot(other);
    release();
    assert.equal((await listing).kind, "blocked");
    assert.equal((await tree.state()).rootName, "other");
    assert.equal(tree.nodes.size, 1);
});

test("deleting the active file does not disable navigation to other available Markdown files", async t => {
    const {root, tree, location} = await fixture(t);
    const current = path.join(root, "current.md");
    await fs.writeFile(current, "current");
    await fs.writeFile(path.join(root, "other.md"), "other");
    const before = await tree.state(current);
    assert.ok(before.currentNodeId);
    await fs.unlink(current);
    const after = await tree.state(current);
    assert.equal(after.kind, "ready");
    assert.equal(after.rootId, before.rootId);
    assert.equal(after.currentNodeId, undefined);
    assert.deepEqual((await tree.list(location())).entries.map(item => item.name), ["other.md"]);
});
