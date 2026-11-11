import {test} from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {createHash} from "node:crypto";
import {createMarkdownAppearance} from "./appearance";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fixture = async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "markdown-appearance-"));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const config = path.join(root, "markdown");
    const workspace = async (name: string, conf: unknown) => {
        const directory = path.join(root, name);
        await fs.mkdir(path.join(directory, "conf"), {recursive: true});
        await fs.writeFile(path.join(directory, "conf", "conf.json"), JSON.stringify(conf));
        return directory;
    };
    const register = (values: string[]) => fs.writeFile(path.join(root, "workspace.json"), JSON.stringify(values));
    return {root, workspace, register, host: createMarkdownAppearance(config)};
};
test("appearance defaults to independent settings and resolves explicit workspace sources independently", async t => {
    const {workspace, register, host} = await fixture(t);
    const a = await workspace("a", {appearance: {mode: 1}, editor: {fontSize: 72, fontFamilies: [{family: "A", weight: 500}]}});
    const b = await workspace("b", {appearance: {modeOS: true}, editor: {fontSize: 9, fontFamily: "Legacy", fontWeight: 600}});
    await register([a, b]);
    assert.equal((await host.load()).fontSize, 16);
    const result = await host.load({theme: hash(a), fontSize: hash(a), fonts: hash(b)});
    assert.equal(result.theme, "dark");
    assert.equal(result.fontSize, 72);
    assert.deepEqual(result.fonts.editor, [{family: "Legacy", weight: 600}]);
    assert.equal(result.workspaces.length, 2);
    assert.equal((await host.load({fontSize: "f".repeat(64)})).fontSize, 16);
    await assert.rejects(host.validate({sources: {theme: "f".repeat(64)}}));
    await assert.rejects(host.validate({unknown: hash(a)}));
    assert.deepEqual(await host.validate({sources: {fonts: hash(a)}}), {sources: {fonts: hash(a)}});
});
test("corrupt and inaccessible workspace configurations fall back safely", async t => {
    const {root, workspace, register, host} = await fixture(t);
    const a = await workspace("a", {editor: {fontSize: 1000, fontFamilies: [{family: "bad\nname"}, {family: "ok", weight: -1}]}});
    await register([a, path.join(root, "missing")]);
    const result = await host.load({fonts: hash(a)});
    assert.equal(result.fontSize, 16);
    assert.deepEqual(result.fonts.editor, [{family: "ok", weight: 400}]);
    await fs.writeFile(path.join(a, "conf", "conf.json"), "{broken");
    assert.deepEqual((await host.load()).fonts.editor, []);
    await fs.writeFile(path.join(root, "workspace.json"), "{broken");
    assert.equal((await host.load()).workspaces.length, 0);
});
test("custom fonts require selected workspace capability, valid hash and no symlinks", async t => {
    const {root, workspace, register, host} = await fixture(t);
    const bytes = Buffer.from("\x00\x01\x00\x00font fixture");
    const id = hash(bytes);
    const a = await workspace("a", {editor: {fontFamilies: [{family: `SiYuanCustomFont-${id}`, weight: 400}]}});
    const b = await workspace("b", {});
    await register([b, a]);
    const directory = path.join(a, "conf", "appearance", "fonts", "custom");
    await fs.mkdir(directory, {recursive: true});
    const file = path.join(directory, `${id}.ttf`);
    await fs.writeFile(file, bytes);
    const initial = await host.load({fonts: hash(a)});
    const token = initial.customFonts[0].url.split("/").pop();
    assert.deepEqual((await host.readFont(token)).bytes, bytes);
    assert.equal(await host.readFont("../conf.json"), undefined);
    assert.equal((await host.load({theme: hash(b), fonts: hash(a)})).customFonts[0].url, initial.customFonts[0].url);
    await fs.writeFile(file, Buffer.from("\x00\x01\x00\x00tampered"));
    assert.equal(await host.readFont(token), undefined);
    await fs.unlink(file);
    const outside = path.join(root, "outside-fonts");
    const outsideFont = path.join(outside, path.basename(file));
    await fs.mkdir(outside);
    await fs.writeFile(outsideFont, bytes);
    await t.test("rejects a symbolic link in place of the font file", async t => {
        try {
            await fs.symlink(outsideFont, file, "file");
        } catch (error) {
            if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
            t.skip("Creating file symbolic links requires Windows developer mode or permission");
            return;
        }
        try {
            assert.equal(await host.readFont(token), undefined);
        } finally {
            await fs.unlink(file);
        }
    });
    await fs.rmdir(directory);
    await fs.symlink(outside, directory, process.platform === "win32" ? "junction" : "dir");
    assert.equal(await host.readFont(token), undefined);
    await fs.unlink(directory);
    await fs.mkdir(directory);
    await fs.writeFile(file, bytes);
    assert.deepEqual((await host.readFont(token)).bytes, bytes);
    await host.load({fonts: "independent"});
    assert.equal(await host.readFont(token), undefined);
    host.close();
    await assert.rejects(host.load());
});

test("independent appearance remains available without a workspace and survives mixed sources", async t => {
    const {workspace, register, host} = await fixture(t);
    const independent = {theme: "light" as const, fontSize: 23, fonts: {global: [{family: "Arial", weight: 400}], editor: [], code: []}};
    const initial = await host.load({}, independent);
    assert.equal(initial.sources.theme, "independent");
    assert.equal(initial.fontSize, 23);
    const a = await workspace("a", {appearance: {mode: 1}, editor: {fontSize: 42}});
    await register([a]);
    const mixed = await host.load({theme: "independent", fonts: "independent"}, independent);
    assert.equal(mixed.theme, "light");
    assert.equal(mixed.fontSize, 23);
    assert.equal((await host.load({fontSize: hash(a)}, independent)).fontSize, 42);
    assert.deepEqual(mixed.fonts.global, independent.fonts.global);
    assert.deepEqual(mixed.customFonts, []);
    await register([]);
    const offline = await host.load({theme: hash(a)}, independent);
    assert.equal(offline.sources.theme, "independent");
    assert.equal(offline.theme, "light");
    await register([a]);
    assert.equal((await host.load(offline.sources, independent)).theme, "light");
    assert.equal((await host.load({theme: hash(a)}, independent)).theme, "dark");
    assert.deepEqual(await host.validate({sources: {fonts: "independent"}, independent}), {sources: {fonts: "independent"}, independent});
    await assert.rejects(host.validate({independent: {fontSize: 73}}));
    await assert.rejects(host.validate({independent: {fonts: {global: [{family: `SiYuanCustomFont-${"a".repeat(64)}`, weight: 400}], editor: [], code: []}}}));
});

test("unreadable workspace configuration switches only its selected groups to independent", async t => {
    const {workspace, register, host} = await fixture(t);
    const a = await workspace("a", {appearance: {mode: 1}});
    const b = await workspace("b", {editor: {fontSize: 30}});
    await register([a, b]);
    await fs.unlink(path.join(a, "conf", "conf.json"));
    const result = await host.load({theme: hash(a), fontSize: hash(b)}, {theme: "light", fontSize: 20});
    assert.equal(result.sources.theme, "independent");
    assert.equal(result.theme, "light");
    assert.equal(result.sources.fontSize, hash(b));
    assert.equal(result.fontSize, 30);
});
