import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {escapeHtml} from "../../util/escape";

const source = ts.createSourceFile("Outline.ts", readFileSync("src/layout/dock/Outline.ts", "utf8"), ts.ScriptTarget.Latest, true);
const method = source.statements.find(ts.isClassDeclaration).members.find(member =>
    member.name?.getText(source) === "updateDocTitle") as ts.MethodDeclaration;
const renderer = {} as {render: (this: unknown, ial?: Record<string, string>, count?: number) => void};
runInNewContext(ts.transpileModule(`exports.render = function(ial, count) ${method.body.getText(source)};`, {
    compilerOptions: {target: ts.ScriptTarget.ES2021},
}).outputText, {
    exports: renderer, escapeHtml,
    getDocDisplayName: (title: string) => title,
    getFileTreeIconHTML: () => "",
    Constants: {ZWSP: "\u200b", CUSTOM_SY_TITLE_EMPTY: "custom-sy-title-empty"},
});

test("clearing the desktop outline removes its hidden title text and tooltip", () => {
    const attributes = new Map<string, string>();
    const hidden = new Set<string>();
    const title = {
        innerHTML: "",
        classList: {add: (name: string) => hidden.add(name), remove: (name: string) => hidden.delete(name)},
        querySelector: (): null => null,
        setAttribute: (key: string, value: string) => attributes.set(key, value),
        removeAttribute: (key: string) => attributes.delete(key),
    };
    const outline = {type: "pin", headerElement: {nextElementSibling: title}};
    renderer.render.call(outline, {title: "Secret/title.sy"}, 0);
    assert.equal(attributes.get("title"), "Secret/title.sy");
    renderer.render.call(outline, null, 0);
    assert.equal(attributes.get("title"), "Secret/title.sy", "count-only updates preserve the title");
    renderer.render.call(outline);
    assert.equal(title.innerHTML, "");
    assert.equal(attributes.has("title"), false);
    assert.equal(hidden.has("fn__none"), true);
});
