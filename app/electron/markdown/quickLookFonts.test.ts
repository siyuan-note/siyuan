import {test} from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {createHash} from "node:crypto";
import {createQuickLookFontSync, prepareQuickLookFontSnapshot, publishQuickLookFonts} from "./quickLookFonts";
import type {QuickLookFontPublication} from "./quickLookFonts";
import {defaultMarkdownAppearance} from "./appearance";

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const token = "a".repeat(48);
const fontBytes = Buffer.from("\0\x01\0\0font fixture");
const id = hash(fontBytes);
const family = `SiYuanCustomFont-${id}`;
const fixture = async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "quicklook-font-sync-"));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    return root;
};
const appearance = () => ({...defaultMarkdownAppearance(),
    fonts: {global: [{family: "Arial", weight: 400}], editor: [{family, weight: 500}], code: [{family: "Menlo", weight: 400}]},
    customFonts: [{family, weight: 500, url: `/appearance-font/${token}`}]});

test("Quick Look sends only resolved metadata and authorized hash-checked font bytes to the native writer", async () => {
    const value = appearance();
    value.workspaces = [{id: "private", name: "private-workspace-path"}];
    const result = await prepareQuickLookFontSnapshot(value, async received => {
        assert.equal(received, token);
        return {bytes: fontBytes, type: "font/ttf"};
    });
    assert.deepEqual(result.fonts, value.fonts);
    assert.deepEqual(result.customFonts, [{family, weight: 500, file: `${id}.ttf`, sha256: id, size: fontBytes.length}]);
    assert.deepEqual(result.files, [{file: `${id}.ttf`, data: fontBytes.toString("base64")}]);
    assert.equal(JSON.stringify(result).includes("private"), false);
    assert.equal(JSON.stringify(result).includes(token), false);
});

test("Quick Look rejects tampered, external and unselected custom fonts while preserving system fallbacks", async () => {
    const value = appearance();
    value.customFonts.push({family: "unselected", weight: 400, url: `/appearance-font/${token}`},
        {family, weight: 400, url: "https://example.com/font.ttf"});
    let calls = 0;
    const result = await prepareQuickLookFontSnapshot(value, async () => {calls++; return {bytes: Buffer.from("bad font"), type: "font/ttf"};});
    assert.equal(calls, 1);
    assert.deepEqual(result.customFonts, []);
    assert.deepEqual(result.files, []);
    assert.deepEqual(result.fonts.global, value.fonts.global);
    value.fonts.editor = [{family: "bad\nfont", weight: 400}, {family: "bad-weight", weight: 1001}];
    assert.deepEqual((await prepareQuickLookFontSnapshot(value, async () => {throw new Error("not selected");})).fonts.editor, []);
});

test("Quick Look retains every selected weight while reading a shared custom font once", async () => {
    const value = appearance();
    value.fonts.global = [{family, weight: 400}];
    value.fonts.code = [{family, weight: 700}];
    let calls = 0;
    const result = await prepareQuickLookFontSnapshot(value, async () => {calls++; return {bytes: fontBytes, type: "font/ttf"};});
    assert.equal(calls, 1);
    assert.deepEqual(result.customFonts.map(font => font.weight), [400, 500, 700]);
    assert.equal(result.files.length, 1);
});

test("Quick Look does not publish cancelled snapshots and resets without custom bytes", async () => {
    let active = true;
    assert.equal(await prepareQuickLookFontSnapshot(appearance(), async () => {
        active = false;
        return {bytes: fontBytes, type: "font/ttf"};
    }, () => active), undefined);
    const reset = await prepareQuickLookFontSnapshot(defaultMarkdownAppearance(), async () => undefined);
    assert.deepEqual(reset.fonts, {global: [], editor: [], code: []});
    assert.deepEqual(reset.files, []);
});

test("Quick Look sync follows saved sources and corrupt preferences without passing workspace paths", async t => {
    const root = await fixture(t);
    const config = path.join(root, "markdown");
    const workspace = path.join(root, "workspace");
    const custom = path.join(workspace, "conf", "appearance", "fonts", "custom");
    await fs.mkdir(custom, {recursive: true});
    await fs.mkdir(config);
    await fs.writeFile(path.join(root, "workspace.json"), JSON.stringify([workspace]));
    await fs.writeFile(path.join(workspace, "conf", "conf.json"), JSON.stringify({editor: {fontFamilies: [{family, weight: 500}]}}));
    await fs.writeFile(path.join(custom, `${id}.ttf`), fontBytes);
    const preferences = path.join(config, "preferences.json");
    const save = (value: object) => fs.writeFile(preferences, JSON.stringify({version: 1, mode: "ir", ...value}));
    const errors: unknown[] = [];
    const publications: QuickLookFontPublication[] = [];
    const sync = createQuickLookFontSync(config, async publication => {publications.push(publication);}, error => errors.push(error));
    t.after(() => sync.close());
    await save({sources: {fonts: hash(workspace)}});
    await Promise.all([sync.refresh(), sync.refresh()]);
    assert.equal(publications.at(-1).customFonts[0].family, family);
    assert.equal(JSON.stringify(publications).includes(workspace), false);
    await save({sources: {fonts: "independent"}, independent: {fonts: {global: [{family: "Arial", weight: 400}], editor: [], code: []}}});
    await sync.refresh();
    assert.equal(publications.at(-1).fonts.global[0].family, "Arial");
    assert.deepEqual(publications.at(-1).files, []);
    await fs.writeFile(preferences, "not json");
    await sync.refresh();
    assert.deepEqual(publications.at(-1).fonts, {global: [], editor: [], code: []});
    assert.equal(errors.length, 1);
    sync.close();
    const count = publications.length;
    await save({sources: {fonts: hash(workspace)}});
    await sync.refresh();
    assert.equal(publications.length, count);
});

test("Quick Look sync aborts a superseded native publication and publishes the newest preferences", async t => {
    const root = await fixture(t);
    const config = path.join(root, "markdown");
    await fs.mkdir(config);
    const preferences = path.join(config, "preferences.json");
    let started: () => void;
    const ready = new Promise<void>(resolve => {started = resolve;});
    let aborted = false;
    const values: QuickLookFontPublication[] = [];
    const sync = createQuickLookFontSync(config, async (publication, signal) => {
        values.push(publication);
        if (values.length === 1) {
            started();
            await new Promise<void>(resolve => signal.addEventListener("abort", () => {aborted = true; resolve();}, {once: true}));
        }
    }, error => {throw error;});
    t.after(() => sync.close());
    const first = sync.refresh();
    await ready;
    await fs.writeFile(preferences, JSON.stringify({version: 1, mode: "ir", independent: {fonts: {global: [{family: "New", weight: 500}], editor: [], code: []}}}));
    await Promise.all([first, sync.refresh()]);
    assert.equal(aborted, true);
    assert.equal(values.at(-1).fonts.global[0].family, "New");
});

test("Quick Look helper failures and cancellation reject without falling back to arbitrary filesystem writes", async () => {
    const publication = await prepareQuickLookFontSnapshot(defaultMarkdownAppearance(), async () => undefined);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(publishQuickLookFonts("missing-font-helper", publication, controller.signal), /cancelled/);
    await assert.rejects(publishQuickLookFonts("missing-font-helper", publication));
});
