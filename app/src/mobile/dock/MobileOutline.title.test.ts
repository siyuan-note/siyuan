import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as escape from "../../util/escape";

const compile = (source: string) => ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
}).outputText;
const names = {} as typeof import("../../util/pathName");
runInNewContext(compile(readFileSync("src/util/pathName.ts", "utf8")), {
    exports: names,
    window: {siyuan: {languages: {_kernel: {16: "Untitled"}}}},
    require: (id: string) => id === "path" ? path : id === "./escape" ? escape : {},
});
const source = ts.createSourceFile("MobileOutline.ts", readFileSync("src/mobile/dock/MobileOutline.ts", "utf8"),
    ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(ts.isClassDeclaration);
const method = declaration.members.find(member => member.name?.getText(source) === "updateDocTitle") as ts.MethodDeclaration;
const renderer = {} as {render: (this: unknown, ial?: Record<string, string>, count?: number) => void};
runInNewContext(compile(`exports.render = function(ial, count) ${method.body.getText(source)};`), {
    exports: renderer,
    getDocDisplayName: names.getDocDisplayName,
    escapeHtml: escape.escapeHtml,
    getFileTreeIconHTML: () => "",
    Constants: {ZWSP: "\u200b", CUSTOM_SY_TITLE_EMPTY: "custom-sy-title-empty"},
});

test("mobile outline preserves complete literal titles and removes hidden title content", () => {
    let visible = false;
    const attributes = new Map<string, string>();
    const element = {
        innerHTML: "",
        classList: {add: () => visible = false, remove: () => visible = true},
        querySelector: (): null => null,
        setAttribute: (key: string, value: string) => attributes.set(key, value),
        removeAttribute: (key: string) => attributes.delete(key),
    };
    const outline = {isPreview: false, element: {querySelector: () => element}};
    for (const title of ["加密/QA19938//%2F/renamed", 'A/<tag> & "B".sy']) {
        renderer.render.call(outline, {title}, 0);
        assert.equal(attributes.get("title"), title);
        assert.equal(element.innerHTML, `<span class="b3-list-item__text">${escape.escapeHtml(title)}</span>`);
        assert.equal(visible, true);
    }
    renderer.render.call(outline, {title: "", "custom-sy-title-empty": "true"}, 0);
    assert.equal(attributes.get("title"), "Untitled");
    outline.isPreview = true;
    renderer.render.call(outline, {title: "Hidden"}, 0);
    assert.equal(visible, false);
    assert.equal(element.innerHTML, "");
    assert.equal(attributes.has("title"), false);
    outline.isPreview = false;
    renderer.render.call(outline, {title: "Secret/title.sy"}, 0);
    renderer.render.call(outline);
    assert.equal(visible, false);
    assert.equal(element.innerHTML, "");
    assert.equal(attributes.has("title"), false);
});
