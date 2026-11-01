const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {test} = require("node:test");
const {importMarkdownImage} = require("./imageImport");

const setup = async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-image-import-"));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const source = path.join(directory, "source.png");
    const targetPath = path.join(directory, "document.md");
    const destination = path.join(directory, "picture #1%.png");
    await fs.writeFile(source, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(targetPath, "# Document");
    return {directory, source, targetPath, destination};
};

test("image import creates a verified new image and an encoded relative Markdown reference", async t => {
    const request = await setup(t);
    const result = await importMarkdownImage(request);
    assert.deepEqual(result, {kind: "imported", reference: "picture%20%231%25.png"});
    assert.deepEqual(await fs.readFile(request.destination), await fs.readFile(request.source));
    assert.equal(await fs.readFile(request.targetPath, "utf8"), "# Document");
    assert.deepEqual((await fs.readdir(request.directory)).sort(), ["document.md", "picture #1%.png", "source.png"]);
});

test("an existing destination and a target created during staging cannot be overwritten", async t => {
    for (const race of [false, true]) {
        const request = await setup(t);
        if (!race) await fs.writeFile(request.destination, "existing");
        const io = {...fs, link: async (...args) => {
            await fs.writeFile(request.destination, "existing");
            return fs.link(...args);
        }};
        const result = await importMarkdownImage(request, {fileSystem: io});
        assert.equal(result.kind, "blocked");
        assert.equal(result.error.code, "occupied");
        assert.equal(await fs.readFile(request.destination, "utf8"), "existing");
    }
});

test("oversized sources are rejected before reading or creating a destination", async t => {
    const request = await setup(t);
    const result = await importMarkdownImage(request, {maximumBytes: 2});
    assert.deepEqual(result, {kind: "blocked", error: {code: "size", recoverable: true}});
    await assert.rejects(fs.stat(request.destination), {code: "ENOENT"});
});

test("only supported images, an existing Markdown document and same-drive relative destinations are accepted", async t => {
    const request = await setup(t);
    assert.equal((await importMarkdownImage({...request, source: request.targetPath})).error.code, "protocol");
    assert.equal((await importMarkdownImage({...request, targetPath: path.join(request.directory, "missing.md")})).kind, "blocked");
    if (process.platform === "win32") {
        const destination = (path.parse(request.targetPath).root.toLowerCase().startsWith("z:") ? "Y:" : "Z:") + "\\copy.png";
        const result = await importMarkdownImage({...request, destination}, {fileSystem: {...fs, realpath: async value =>
            value === path.dirname(destination) ? path.dirname(destination) : fs.realpath(value)}});
        assert.equal(result.error.code, "cross-volume");
    }
});

test("a changed selected parent junction is rejected without copying to the replacement directory", async t => {
    const request = await setup(t);
    const first = path.join(request.directory, "first");
    const second = path.join(request.directory, "second");
    const selected = path.join(request.directory, "selected");
    await fs.mkdir(first); await fs.mkdir(second);
    await fs.symlink(first, selected, "junction");
    let redirected = false;
    const io = {...fs, open: async (...args) => {
        const file = await fs.open(...args);
        if (args[1] !== "wx") return file;
        return {writeFile: async bytes => {
            await file.writeFile(bytes);
            await fs.unlink(selected);
            await fs.symlink(second, selected, "junction");
            redirected = true;
        }, sync: () => file.sync(), close: () => file.close()};
    }};
    const result = await importMarkdownImage({...request, destination: path.join(selected, "image.png")}, {fileSystem: io});
    assert.equal(redirected, true);
    assert.equal(result.error.code, "identity-changed");
    assert.deepEqual(await fs.readdir(first), []);
    assert.deepEqual(await fs.readdir(second), []);
});

test("a lost acknowledgement retains the created image but never returns an insertable reference", async t => {
    const request = await setup(t);
    const result = await importMarkdownImage(request, {fileSystem: {...fs, link: async (...args) => {
        await fs.link(...args);
        throw new Error("ack lost");
    }}});
    assert.equal(result.kind, "indeterminate");
    assert.equal(result.reference, undefined);
    assert.deepEqual(await fs.readFile(request.destination), await fs.readFile(request.source));
});

test("a source replaced between stat and open is rejected using the opened file identity", async t => {
    const request = await setup(t);
    let replaced = false;
    const result = await importMarkdownImage(request, {fileSystem: {...fs, open: async (...args) => {
        if (args[0] === request.source && !replaced) {
            const other = path.join(request.directory, "replacement.png");
            await fs.writeFile(other, "different image");
            await fs.rename(other, request.source);
            replaced = true;
        }
        return fs.open(...args);
    }}});
    assert.equal(result.kind, "blocked");
    assert.equal(result.error.code, "identity-changed");
    await assert.rejects(fs.stat(request.destination), {code: "ENOENT"});
});
