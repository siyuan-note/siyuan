import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("search preview applies query, attributes and rich title only after document navigation completes", () => {
    const source = readFileSync(__dirname + "/util.ts", "utf8");
    const code = transpileModule(source.slice(source.indexOf("export const getArticle ="),
        source.indexOf("export const replace =")), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const callbacks: Array<(response: unknown) => void> = [];
    let render: {beforeAVRender: () => void, afterCB: () => void, isValid: () => boolean};
    const applied: string[] = [];
    let current = true;
    const protyle = {notebookId: "box", scroll: {lastScrollTop: 3}, query: {key: "old"},
        options: {render: {title: true}},
        title: {render: () => applied.push("title")}, wysiwyg: {renderCustom: () => applied.push("attributes")}};
    const api: {getArticle?: (options: unknown) => void} = {};
    runInNewContext(code, {exports: api,
        window: {siyuan: {config: {editor: {dynamicLoadBlocks: 128}}}}, Constants: {CB_GET_HTML: "html"},
        beginSearchPreviewRequest: () => () => current,
        checkFold: (_id: string, callback: (zoom: boolean) => void) => callback(false),
        addLoading: () => {}, isEncryptedBox: () => false, isSupportCSSHL: () => true,
        fetchPost: (_url: string, _data: unknown, callback: typeof callbacks[number]) => callbacks.push(callback),
        onGet: (options: typeof render) => { render = options; },
    });
    api.getArticle({id: "new-root", edit: {protyle}, value: "new"});
    callbacks[0]({code: 0, data: {ial: {title: "New title"}}});
    callbacks[1]({code: 0, data: {rootID: "new-root"}});
    assert.equal(protyle.query.key, "old");
    assert.deepEqual(applied, []);
    render.beforeAVRender();
    assert.equal(protyle.query.key, "new");
    assert.deepEqual(applied, ["attributes"]);
    render.afterCB();
    assert.deepEqual(applied, ["attributes", "title"]);
    assert.equal(render.isValid(), true);
    current = false;
    assert.equal(render.isValid(), false);
});
