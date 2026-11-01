const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {MarkdownResources} = require("./resources");

const fixture = async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-markdown-resources-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await fs.rm(directory, {recursive: true, force: true});
    });
    return {directory, resources: new MarkdownResources("test-session"), target: path.join(directory, "note.md")};
};
const token = url => new URL(url).pathname.split("/").at(-1);

test("a single image grant never authorizes its neighboring files and is invalidated by replacement", async t => {
    const {directory, target, resources} = await fixture(t);
    const selected = path.join(directory, "selected.png");
    await fs.writeFile(selected, "selected");
    await fs.writeFile(path.join(directory, "neighbor.png"), "private neighbor");
    await resources.authorizeFile(selected);
    const url = await resources.resolve("selected.png", target);
    assert.ok(url);
    assert.equal(await resources.resolve("neighbor.png", target), undefined);
    assert.equal((await resources.read(token(url))).bytes.toString(), "selected");
    await fs.rename(selected, path.join(directory, "old.png"));
    await fs.writeFile(selected, "replacement");
    assert.equal(await resources.read(token(url)), undefined);
    assert.equal(await resources.resolve("selected.png", target), undefined);
});

test("directory grants reject encoded traversal, protocols and a junction escaping the granted directory", async t => {
    const {directory, resources, target} = await fixture(t);
    const granted = path.join(directory, "images");
    const outside = path.join(directory, "outside");
    await fs.mkdir(granted);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "private.png"), "secret");
    await resources.authorizeDirectory(granted);
    for (const reference of ["images/%2e%2e/outside/private.png", "https://example.com/pixel.png", "file:///private.png", "%00.png", "%2fprivate.png"]) {
        assert.equal(await resources.resolve(reference, target), undefined);
    }
    await fs.symlink(outside, path.join(granted, "escape"), process.platform === "win32" ? "junction" : "dir");
    assert.equal(await resources.resolve("images/escape/private.png", target), undefined);
});

test("resource tokens expire on clear and never acquire new file identities", async t => {
    const {directory, resources, target} = await fixture(t);
    const file = path.join(directory, "image.png");
    await fs.writeFile(file, "image");
    await resources.authorizeDirectory(directory);
    const url = await resources.resolve("image.png", target);
    resources.clear();
    assert.equal(await resources.read(token(url)), undefined);
    assert.notEqual(await resources.resolve("image.png", target), url);
});

test("replacing a granted directory revokes new resolutions and already issued tokens", async t => {
    const {directory, resources, target} = await fixture(t);
    const selected = path.join(directory, "images");
    const moved = path.join(directory, "original-images");
    await fs.mkdir(selected);
    await fs.writeFile(path.join(selected, "old.png"), "old image");
    await resources.authorizeDirectory(selected);
    const url = await resources.resolve("images/old.png", target);
    await fs.rename(selected, moved); await fs.mkdir(selected);
    // 保持文件身份也不能把旧目录授权转移给替换目录。
    await fs.link(path.join(moved, "old.png"), path.join(selected, "old.png"));
    await fs.writeFile(path.join(selected, "private.png"), "replacement private image");
    assert.equal(await resources.resolve("images/private.png", target), undefined);
    assert.equal(await resources.read(token(url)), undefined);
    await resources.authorizeDirectory(selected);
    assert.ok(await resources.resolve("images/private.png", target));
});

test("changing the selected directory junction invalidates its unchanged canonical directory grant", async t => {
    const {directory, resources, target} = await fixture(t);
    const first = path.join(directory, "first"); const second = path.join(directory, "second"); const alias = path.join(directory, "alias");
    await fs.mkdir(first); await fs.mkdir(second); await fs.writeFile(path.join(first, "image.png"), "image");
    await fs.symlink(first, alias, process.platform === "win32" ? "junction" : "dir");
    await resources.authorizeDirectory(alias);
    const url = await resources.resolve("first/image.png", target);
    await fs.unlink(alias); await fs.symlink(second, alias, process.platform === "win32" ? "junction" : "dir");
    assert.equal(await resources.resolve("first/image.png", target), undefined);
    assert.equal(await resources.read(token(url)), undefined);
});
