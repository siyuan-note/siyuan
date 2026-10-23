import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import * as escape from "./escape";

const names = {} as typeof import("./pathName");
runInNewContext(transpileModule(readFileSync("src/util/pathName.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText, {
    exports: names,
    window: {siyuan: {languages: {_kernel: {16: "Untitled"}}}},
    require: (id: string) => id === "path" ? path : id === "./escape" ? escape : {},
});

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
