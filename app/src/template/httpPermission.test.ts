import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const fixture = () => {
    const requests: Array<{url: string, data: Record<string, unknown>, resolve: (value: unknown) => void}> = [];
    const exports: Record<string, (...args: any[]) => any> = {};
    let cleared = 0;
    runInNewContext(transpileModule(readFileSync("src/template/httpPermission.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports, window: {siyuan: {languages: {templateHTTPAllowed: "allowed",
        templateHTTPNotAllowed: "not allowed", templateHTTPPermissionUnknown: "unknown"}}},
    require: (path: string) => path === "../util/fetch" ? {
        fetchSyncPost: (url: string, data: Record<string, unknown>) => new Promise(resolve => requests.push({url, data, resolve})),
    } : {clearTemplateHTTPConfirmations: () => {cleared++;}}});
    return {exports, requests, cleared: () => cleared};
};

test("only successful revocation clears preview handoffs, and revokeAll has no file filter", async () => {
    const state = fixture();
    const source = {kind: "av", avID: "database", keyID: "column", slot: "renderTemplate"};
    let response = state.exports.templateHTTPPermission("get", source);
    assert.deepEqual(JSON.parse(JSON.stringify(state.requests[0].data)), {action: "get", ...source});
    state.requests[0].resolve({code: 0, data: {allowed: true}});
    assert.equal(await response, true);
    assert.equal(state.cleared(), 0);
    response = state.exports.templateHTTPPermission("revoke", source);
    state.requests[1].resolve({code: -1});
    assert.equal(await response, undefined);
    assert.equal(state.cleared(), 0);
    response = state.exports.templateHTTPPermission("revokeAll");
    assert.deepEqual(JSON.parse(JSON.stringify(state.requests[2].data)), {action: "revokeAll"});
    state.requests[2].resolve({code: 0, data: {allowed: false}});
    assert.equal(await response, false);
    assert.equal(state.cleared(), 1);
});

test("AV permission controls reject stale results after editing or menu destruction", async () => {
    const state = fixture();
    const listeners: Record<string, (event?: unknown) => void> = {};
    const label = {textContent: ""};
    const button = {isConnected: true, disabled: false, querySelector: () => label,
        addEventListener: (name: string, callback: () => void) => {listeners[name] = callback;}};
    const textarea = {addEventListener: (name: string, callback: () => void) => {listeners[name] = callback;}};
    const element = {querySelector: (selector: string) => selector.startsWith("[data-http") ? button : textarea};
    state.exports.bindTemplateHTTPPermission(element, {kind: "av", avID: "a", keyID: "k", slot: "template"});
    listeners.input();
    state.requests[0].resolve({code: 0, data: {allowed: true}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(label.textContent, "unknown");
    listeners.click({stopPropagation: () => {}});
    button.isConnected = false;
    state.requests[1].resolve({code: 0, data: {allowed: false}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(label.textContent, "unknown");
    assert.equal(state.cleared(), 1);
});

test("manager and database use existing surfaces and distinguish template slots", () => {
    const manager = readFileSync("src/template/manager.ts", "utf8");
    assert.match(manager, /templateHTTPRevokeAllConfirm/);
    assert.match(manager, /templateHTTPPermission\("revokeAll"\)/);
    assert.match(manager, /templateHTTPPermission\("revoke", \{kind: "file", path: entry.path\}\)/);
    assert.match(manager, /dirty\(\) \? source.value : undefined/);
    const column = readFileSync("src/protyle/render/av/col.ts", "utf8");
    assert.match(column, /templateHTTPPermissionHTML\("template"\)/);
    assert.match(column, /templateHTTPPermissionHTML\("renderTemplate"\)/);
    assert.match(column, /kind: "av", avID, keyID: colId, slot/);
});


test("long permission actions reuse wrapping buttons for narrow windows", () => {
    assert.match(readFileSync("src/template/http.ts", "utf8"),
        /querySelector\("#extraDialogConfirmBtn"\)\?\.classList.add\("b3-button--wrap"\)/);
    assert.match(readFileSync("src/template/manager.ts", "utf8"),
        /action === "revokeAllHTTP" \? " b3-button--wrap"/);
});
