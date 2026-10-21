import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
const {createMockRequire} = require("../../tests/fixtures/mockModules.cjs");

const harness = () => {
    let click: () => void;
    let sortBy = "viewedAt";
    let active = true;
    let cleared = 0;
    const hidden = new Set<string>();
    const button = {disabled: false, classList: {toggle: (name: string, value: boolean) => value ? hidden.add(name) : hidden.delete(name)},
        addEventListener: (_name: string, callback: () => void) => { click = callback; }};
    const confirmations: Array<{confirm: () => Promise<void>, cancel: () => void}> = [];
    const requests: Array<{resolve: (response: {code: number}) => void, reject: (error: Error) => void}> = [];
    const errors: string[] = [];
    const siyuan = {config: {readonly: false}, isPublish: false,
        languages: {clearRecentDocs: "Clear recent history", confirmClearRecentDocs: "Confirm clear"}};
    const exports: any = {};
    runInNewContext(transpileModule(readFileSync("src/business/clearRecentDocs.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports, window: {siyuan}, require: createMockRequire({
        "../dialog/confirmDialog": {confirmDialog: (_title: string, _text: string, confirm: () => Promise<void>, cancel: () => void) =>
            confirmations.push({confirm, cancel})},
        "../dialog/message": {showMessage: (message: string) => errors.push(message)},
        "../util/fetch": {fetchSyncPost: (url: string) => {
            assert.equal(url, "/api/storage/clearRecentDocs");
            return new Promise((resolve, reject) => requests.push({resolve, reject}));
        }},
        "../util/escape": {escapeHtmlTextAndAttr: (text: string) => text},
    })});
    const update = exports.bindClearRecentDocs(button, () => sortBy, () => active, () => cleared++);
    return {button, hidden, confirmations, requests, errors, siyuan, update, click: () => click(),
        sort: (value: string) => { sortBy = value; update(); }, deactivate: () => { active = false; }, cleared: () => cleared};
};

test("clear recent history requires confirmation and prevents duplicate submissions", async () => {
    const h = harness();
    h.click();
    h.click();
    assert.equal(h.confirmations.length, 1);
    assert.equal(h.requests.length, 0);
    assert.equal(h.button.disabled, true);
    h.confirmations[0].cancel();
    assert.equal(h.button.disabled, false);
    h.click();
    const pending = h.confirmations[1].confirm();
    h.click();
    h.requests[0].resolve({code: 0});
    await pending;
    assert.equal(h.cleared(), 1);
    assert.equal(h.button.disabled, false);
});

test("failed clears retain records and allow retry", async () => {
    for (const networkFailure of [false, true]) {
        const h = harness();
        h.click();
        const pending = h.confirmations[0].confirm();
        if (networkFailure) {
            h.requests[0].reject(new Error("offline"));
        } else {
            h.requests[0].resolve({code: -1});
        }
        await pending;
        assert.equal(h.cleared(), 0);
        assert.equal(h.button.disabled, false);
        assert.deepEqual(h.errors, networkFailure ? ["offline"] : []);
        h.click();
        assert.equal(h.confirmations.length, 2);
    }
});

test("clear is available only in writable history views", () => {
    const h = harness();
    for (const mode of ["created", "updated"]) {
        h.sort(mode);
        assert.equal(h.hidden.has("fn__none"), true);
        h.click();
    }
    for (const mode of ["viewedAt", "openAt", "closedAt"]) {
        h.sort(mode);
        assert.equal(h.hidden.has("fn__none"), false);
    }
    h.siyuan.config.readonly = true;
    h.update();
    h.click();
    assert.equal(h.hidden.has("fn__none"), true);
    h.siyuan.config.readonly = false;
    h.siyuan.isPublish = true;
    h.update();
    h.click();
    assert.equal(h.confirmations.length, 0);
    assert.equal(h.hidden.has("fn__none"), true);
});

test("closed views cannot submit a confirmation or receive a late clear result", async () => {
    for (const beforeRequest of [false, true]) {
        const h = harness();
        h.click();
        if (beforeRequest) {
            h.deactivate();
        }
        const pending = h.confirmations[0].confirm();
        if (!beforeRequest) {
            h.deactivate();
            h.requests[0].resolve({code: 0});
        }
        await pending;
        assert.equal(h.requests.length, beforeRequest ? 0 : 1);
        assert.equal(h.cleared(), 0);
    }
});
