import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import test from "node:test";
import {ScriptTarget, transpileModule} from "typescript";

const source = transpileModule(readFileSync(path.join(__dirname, "conversion.ts"), "utf8")
    .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;
const setup = () => {
    const calls: string[] = [];
    const root = {};
    let embedded = false;
    const owner = {block: {rootID: "doc"}, notebookId: "box", disabled: false, lite: false, fragment: false,
        options: {action: [] as string[]}, wysiwyg: {element: root, flushPendingInput: async () => { calls.push("flush"); }}};
    const attributes = new Map([["data-node-id", "map"], ["data-type", "NodeMindmap"]]);
    const fullAttributes = new Map(attributes);
    const full = {getAttribute: (name: string) => fullAttributes.get(name)};
    const list = {isConnected: true, outerHTML: "visible", getAttribute: (name: string) => attributes.get(name),
        closest: (selector: string) => selector === ".protyle-wysiwyg" ? root : embedded ? {} : null,
        ownerDocument: {createElement: () => ({content: {firstElementChild: full}, innerHTML: ""})}};
    let resolve: (response: any) => void;
    let reject: (error: Error) => void;
    const pending = new Promise((done, fail) => { resolve = done; reject = fail; });
    const dependencies = {
        Constants: {CB_GET_HISTORY: "history"}, normalizeHTMLAssetIFrameBlockDOM: (html: string) => html,
        isProtyleListItemFragment: (protyle: typeof owner) => protyle.fragment,
        fetchSyncPost: (url: string, data: unknown) => {
            assert.equal(url, "/api/block/getBlockDOM");
            assert.deepEqual(data, {id: "map", notebook: "box"});
            calls.push("fetch");
            return pending;
        },
        waitForPendingTransactions: async () => { calls.push("wait"); },
        completeTabsListSource: (visible: unknown, complete: unknown) => {
            assert.equal(visible, list);
            assert.equal(complete, full);
            calls.push("complete");
            return {outerHTML: "completed"};
        }, cleanListMindmapHTML: (html: string) => html,
    };
    const prepare = new Function(...Object.keys(dependencies), source + "; return prepareListMindmapConversion;")(
        ...Object.values(dependencies));
    return {owner, list, calls, attributes, fullAttributes, prepare, resolve, reject,
        embed: () => { embedded = true; }};
};
const flush = async () => { for (let index = 0; index < 6; index++) { await Promise.resolve(); } };

test("root conversion completes folded source after pending input and transactions", async () => {
    const state = setup();
    const promise = state.prepare(state.owner, state.list);
    await flush();
    assert.deepEqual(state.calls, ["flush", "wait", "fetch"]);
    state.resolve({code: 0, data: {dom: "full"}});
    assert.deepEqual(await promise, {outerHTML: "completed"});
    assert.equal(state.list.outerHTML, "visible", "preparing the full source never mutates live content");
});

test("inaccessible source never submits a root conversion read", async () => {
    for (const mode of ["removed", "id", "readonly", "history", "embed", "editor", "lite"]) {
        const state = setup();
        if (mode === "removed") { state.list.isConnected = false; }
        if (mode === "id") { state.attributes.delete("data-node-id"); }
        if (mode === "readonly") { state.owner.disabled = true; }
        if (mode === "history") { state.owner.options.action.push("history"); }
        if (mode === "embed") { state.embed(); }
        if (mode === "editor") { state.owner.wysiwyg.element = {}; }
        if (mode === "lite") { state.owner.lite = true; }
        assert.equal(await state.prepare(state.owner, state.list), undefined, mode);
        assert.deepEqual(state.calls, [], mode);
    }
});

test("an editable list-item fragment keeps its local full content without a server read", async () => {
    const state = setup();
    state.owner.lite = true;
    state.owner.fragment = true;
    assert.ok(await state.prepare(state.owner, state.list));
    assert.deepEqual(state.calls, ["flush", "wait"]);
});

test("late source reads cannot overwrite edits or a changed document", async () => {
    for (const mode of ["content", "document", "notebook", "readonly", "history", "embed", "editor", "removed", "type", "id"]) {
        const state = setup();
        const promise = state.prepare(state.owner, state.list);
        await flush();
        if (mode === "content") { state.list.outerHTML = "edited"; }
        if (mode === "document") { state.owner.block.rootID = "other"; }
        if (mode === "notebook") { state.owner.notebookId = "other"; }
        if (mode === "readonly") { state.owner.disabled = true; }
        if (mode === "history") { state.owner.options.action.push("history"); }
        if (mode === "embed") { state.embed(); }
        if (mode === "editor") { state.owner.wysiwyg.element = {}; }
        if (mode === "removed") { state.list.isConnected = false; }
        if (mode === "type") { state.attributes.set("data-type", "NodeList"); }
        if (mode === "id") { state.attributes.set("data-node-id", "other"); }
        state.resolve({code: 0, data: {dom: "full"}});
        assert.equal(await promise, undefined, mode);
        assert.equal(state.calls.includes("complete"), false, mode);
    }
});

test("failed or mismatched full source reads do not produce conversion content", async () => {
    for (const mode of ["error", "id", "type"]) {
        const state = setup();
        const promise = state.prepare(state.owner, state.list);
        await flush();
        if (mode === "id") { state.fullAttributes.set("data-node-id", "other"); }
        if (mode === "type") { state.fullAttributes.set("data-type", "NodeList"); }
        state.resolve({code: mode === "error" ? 1 : 0, data: {dom: "full"}});
        assert.equal(await promise, undefined, mode);
        assert.equal(state.calls.includes("complete"), false, mode);
    }
    const state = setup();
    const promise = state.prepare(state.owner, state.list);
    await flush();
    state.reject(new Error("unavailable"));
    await assert.rejects(promise, /unavailable/);
    assert.equal(state.list.outerHTML, "visible");
});
