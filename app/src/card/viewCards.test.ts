import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = readFileSync(__dirname + "/viewCards.ts", "utf8");
const code = transpileModule(source.slice(source.indexOf("const getArticle =")).replace("const getArticle =", "export const getArticle ="), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const setup = () => {
    const requests: Array<{url: string, resolve: (response: unknown) => void}> = [];
    const renders: Array<{beforeAVRender: () => void, isValid: () => boolean, afterCB: () => void, onAVRenderError: () => void}> = [];
    let attributes = 0;
    let loading = false;
    const classList = {add() {}, remove() {}, contains: () => true};
    const protyle = {element: {isConnected: true, dataset: {loadingCardId: ""}, classList, nextElementSibling: {classList}},
        scroll: {lastScrollTop: 0}, wysiwyg: {renderCustom: () => attributes++}};
    const api: {getArticle?: (edit: unknown, id: string) => Promise<boolean>} = {};
    runInNewContext(code, {exports: api, Constants: {}, addLoading() { loading = true; }, removeLoading() { loading = false; },
        fetchSyncPost: (url: string) => new Promise(resolve => requests.push({url, resolve})),
        onGet: (options: typeof renders[number]) => renders.push(options),
    });
    return {api, protyle, requests, renders, attributes: () => attributes, loading: () => loading};
};

test("card browser waits for rendering and delays document attributes until title saving allows a current render", async () => {
    const q = setup();
    let completed = false;
    const pending = q.api.getArticle({protyle: q.protyle}, "card1").then(result => { completed = true; return result; });
    q.requests[0].resolve({code: 0, data: {ial: {}}});
    await tick();
    q.requests[1].resolve({code: 0, data: {id: "card1", rootID: "card1"}});
    await tick();
    assert.equal(completed, false);
    assert.equal(q.loading(), true);
    assert.equal(q.attributes(), 0);
    assert.equal(q.renders[0].isValid(), true);
    q.renders[0].beforeAVRender();
    assert.equal(q.attributes(), 1);
    q.renders[0].afterCB();
    assert.equal(await pending, true);
    assert.equal(q.loading(), false);
    const next = q.api.getArticle({protyle: q.protyle}, "card2");
    assert.equal(q.renders[0].isValid(), false);
    q.requests[2].resolve({code: -1});
    assert.equal(await next, false);
    assert.equal(q.loading(), false);
});

test("card browser ignores stale or detached replies and releases failed renders", async () => {
    for (const invalid of ["stale", "detached", "failure", "render-failure"]) {
        const q = setup();
        const pending = q.api.getArticle({protyle: q.protyle}, "card1");
        q.requests[0].resolve({code: 0, data: {ial: {}}});
        await tick();
        if (invalid === "stale") q.protyle.element.dataset.loadingCardId = "new-card";
        if (invalid === "detached") q.protyle.element.isConnected = false;
        q.requests[1].resolve({code: invalid === "failure" ? -1 : 0, data: {id: "card1", rootID: "card1"}});
        await tick();
        if (invalid === "render-failure") q.renders[0].onAVRenderError();
        else assert.equal(q.renders.length, 0, invalid);
        assert.equal(await pending, false, invalid);
        assert.equal(q.loading(), invalid === "stale" || invalid === "detached", invalid);
        assert.equal(q.attributes(), 0, invalid);
    }
});
