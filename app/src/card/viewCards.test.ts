import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("card browser delays document attributes until title saving allows a current render", () => {
    const source = readFileSync(__dirname + "/viewCards.ts", "utf8");
    const code = transpileModule(source.slice(source.indexOf("const getArticle =")).replace("const getArticle =", "export const getArticle ="), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const callbacks: Array<(response: unknown) => void> = [];
    let rendering: {beforeAVRender: () => void, isValid: () => boolean};
    let attributes = 0;
    const classList = {add() {}, remove() {}};
    const protyle = {element: {dataset: {loadingCardId: ""}, classList, nextElementSibling: {classList}},
        scroll: {lastScrollTop: 0}, wysiwyg: {renderCustom: () => attributes++}};
    const api: {getArticle?: (edit: unknown, id: string) => void} = {};
    runInNewContext(code, {exports: api, Constants: {}, addLoading() {},
        fetchPost: (_url: string, _data: unknown, callback: typeof callbacks[number]) => callbacks.push(callback),
        onGet: (options: typeof rendering) => { rendering = options; },
    });
    api.getArticle({protyle}, "card1");
    callbacks[0]({code: 0, data: {ial: {}}});
    callbacks[1]({code: 0, data: {id: "card1", rootID: "card1"}});
    assert.equal(attributes, 0);
    assert.equal(rendering.isValid(), true);
    rendering.beforeAVRender();
    assert.equal(attributes, 1);
    api.getArticle({protyle}, "card2");
    assert.equal(rendering.isValid(), false);
});
