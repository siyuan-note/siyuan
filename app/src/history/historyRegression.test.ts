import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import type {Node} from "typescript";

const source = readFileSync("src/history/history.ts", "utf8");
const parsed = createSourceFile("history.ts", source, ScriptTarget.Latest, true);
const extract = (name: string) => {
    let result: string;
    const visit = (node: Node) => {
        if (isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(parsed) === name)) {
            result = node.getText(parsed);
            return;
        }
        node.forEachChild(visit);
    };
    visit(parsed);
    assert.ok(result);
    return transpileModule(result, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
};

test("file history displays zero histories for an empty search", () => {
    const count = {textContent: "old count", classList: {remove() {}}};
    const node = () => ({value: "0", textContent: "", classList: {add() {}, remove() {}}, setAttribute() {}, removeAttribute() {}, querySelector: node});
    const next = {...node(), nextElementSibling: {nextElementSibling: count}};
    const list = {...node(), innerHTML: "old results"};
    const element = {
        setAttribute() {},
        querySelector: (selector: string) => selector === '[data-type="docnext"]' ? next : selector === ".b3-list" ? list : node(),
    };
    const dependencies = {
        window: {siyuan: {storage: {history: {}}, languages: {pageCountAndHistoryCount: "${x} pages, ${y} histories", emptyContent: "empty"}}},
        Constants: {LOCAL_HISTORY: "history"},
        setStorageVal() {},
        fetchPost: (_url: string, _request: unknown, callback: (response: unknown) => void) =>
            callback({data: {pageCount: 0, totalCount: 0, histories: []}}),
    };
    const render = new Function(...Object.keys(dependencies), extract("renderDoc") + "\nreturn renderDoc;")(...Object.values(dependencies));
    render(element, 1);
    assert.equal(count.textContent, "0 pages, 0 histories");
    assert.match(list.innerHTML, /empty/);
});

test("notebook recovery renders a native button in a visible history row", () => {
    const element = {innerHTML: "", setAttribute() {}};
    const dependencies = {
        window: {siyuan: {languages: {rollback: "Rollback"}}},
        escapeHtml: (text: string) => text,
        fetchPost: (_url: string, _request: unknown, callback: (response: unknown) => void) =>
            callback({data: {histories: [{hCreated: "now", items: [{path: "history/notebook", title: "Notebook"}]}]}}),
    };
    const render = new Function(...Object.keys(dependencies), extract("renderRmNotebook") + "\nreturn renderRmNotebook;")(...Object.values(dependencies));
    render(element);
    assert.match(element.innerHTML, /<button type="button"[^>]*data-type="rollback"[^>]*aria-label="Rollback">/);
    assert.doesNotMatch(element.innerHTML, /b3-list-item--hide-action/);
});
