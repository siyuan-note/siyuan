import * as assert from "node:assert/strict";
import * as path from "node:path";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../testSupport/loadModule";
import * as escape from "./escape";
import * as mergePathSegments from "./mergePathSegments";

const names = loadModule<typeof import("./pathName")>("src/util/pathName.ts", {
    window: {siyuan: {languages: {_kernel: {16: "Untitled"}}}},
    require: (id: string) => id === "path" ? path : id === "./escape" ? escape :
        id === "./mergePathSegments" ? mergePathSegments : {},
}, ScriptTarget.ES2021);

test("document display names preserve complete literal titles", () => {
    for (const title of ["Plain", "A/B", "/A//B/", "A／B", "A%2FB", ".", "..", "/", "A/../B",
        "note.sy", "folder/note.sy", ".sy", "中文/😀/标题.sy", "**bold**/[link](url)", ""]) {
        assert.equal(names.getDocDisplayName(title), title, title);
    }
});

test("document display names keep empty-title placeholders and escape the entire title", () => {
    assert.equal(names.getDocDisplayName("", true), "Untitled");
    assert.equal(names.getDocDisplayName("legacy placeholder", true, true), "Untitled");
    assert.equal(names.getDocDisplayName('A/<tag> & "B".sy', false, true),
        "A/&lt;tag&gt; &amp; &quot;B&quot;.sy");
    assert.equal(names.getDocDisplayName('A/<tag> & "B".sy', false), 'A/<tag> & "B".sy');
});

test("physical file display names retain their separate basename and extension behavior", () => {
    assert.equal(names.getDisplayName("folder/note.sy", true, true), "note");
    assert.equal(names.getDisplayName("folder/note.sy", false), "folder/note.sy");
    assert.equal(names.getDisplayName("assets/image.png"), "image.png");
});

test("asset names and extensions ignore query strings and fragments", () => {
    for (const [assetPath, extension, name] of [
        ["assets/image.png", ".png", "image"],
        ["assets/image.png#preview", ".png", "image"],
        ["assets/image.png?box=notebook#preview", ".png", "image"],
        ["assets/image.png#preview?download=true", ".png", "image"],
        ["assets/folder.with.dots/video.mp4#t=10", ".mp4", "video"],
        ["assets/image-20261024000000-abcdefg.PNG#preview", ".PNG", "image"],
        ["assets/image%23copy%3F1.png#preview", ".png", "image%23copy%3F1"],
    ]) {
        assert.equal(names.getAssetExtension(assetPath), extension, assetPath);
        assert.equal(names.getAssetName(assetPath), name, assetPath);
    }
});

test("storage paths keep valid segments inside the root", () => {
    for (const [storageName, expected] of [
        ["config.json", "config.json"],
        ["folder/config.json", "folder/config.json"],
        ["folder\\config.json", "folder/config.json"],
        ["./folder//config.json", "folder/config.json"],
        ["a/../b.json", "b.json"],
        ["../x.json", "x.json"],
        ["../../a/../b/c.json", "b/c.json"],
        ["...", "..."],
    ]) {
        assert.equal(names.normalizeStoragePath(storageName), expected, storageName);
    }
});

test("storage paths without a file segment are rejected instead of addressing the root or its parent", () => {
    for (const storageName of ["", ".", "..", "../", "..\\", "./..", "../..", "a/..", "/", "\\", "./"]) {
        assert.equal(names.normalizeStoragePath(storageName), null, JSON.stringify(storageName));
    }
});

test("asset paths drop fragments but keep queries for kernel resolution", () => {
    for (const [assetPath, expected] of [
        ["assets/image.png", "assets/image.png"],
        ["assets/image.png#preview", "assets/image.png"],
        ["assets/video.mp4#t=10", "assets/video.mp4"],
        ["assets/image.png?box=20260101000000-abcdefg#preview", "assets/image.png?box=20260101000000-abcdefg"],
        ["assets/image.png?v=1.2", "assets/image.png?v=1.2"],
        ["assets/image%23copy.png#preview", "assets/image%23copy.png"],
    ]) {
        assert.equal(names.getAssetPathWithoutFragment(assetPath), expected, assetPath);
    }
});
