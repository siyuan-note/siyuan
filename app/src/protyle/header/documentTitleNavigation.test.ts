import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (source: string) => transpileModule(source, {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const deferred = () => {
    let accept: () => void;
    let reject: (error: Error) => void;
    const promise = new Promise<void>((resolve, failure) => { accept = resolve; reject = failure; });
    return {promise, accept: () => accept(), reject: (error: Error) => reject(error)};
};

const setup = () => {
    const messages: string[] = [];
    const pending: ReturnType<typeof deferred>[] = [];
    const applied: string[] = [];
    let failed = 0;
    let loadingRemoved = 0;
    const noop = () => {};
    const window = {siyuan: {languages: {settingsPendingSaveError: "Save failed"}, config: {editor: {}}}};
    const navigation: {deferDocumentTitleNavigation?: unknown} = {};
    runInNewContext(compile(readFileSync(join(__dirname, "documentTitleNavigation.ts"), "utf8")), {
        exports: navigation, window, Error,
        require: () => ({showMessage: (message: string) => messages.push(message), removeLoading: () => loadingRemoved++}),
    });
    const title = {element: {isConnected: true}, prepareForDocumentSwitch: (id: string) => {
        if (id === "old-root") return;
        const save = deferred();
        pending.push(save);
        return save.promise;
    }};
    const protyle = {title, notebookId: "old-box", path: "/old.sy", block: {rootID: "old-root"},
        options: {render: {title: false}}, contentElement: {scrollTop: 75},
        scroll: {invalidateDynamicLoad: noop, lastScrollTop: 75},
        wysiwyg: {element: {removeAttribute: noop, setAttribute: noop}}};
    const source = readFileSync(join(__dirname, "../util/onGet.ts"), "utf8");
    const api: {onGet?: (options: unknown) => void} = {};
    runInNewContext(compile(source.slice(source.indexOf("export const onGet ="), source.indexOf("const setHTML ="))), {
        exports: api, window, ...navigation,
        Constants: {CB_GET_HTML: "html", CB_GET_APPEND: "append", CB_GET_BEFORE: "before"},
        hideElements: noop, invalidateTrackedRanges: noop,
        invalidateHeadingNumberRefresh: noop, removeLoading: () => loadingRemoved++,
        setHTML: (options: {afterCB?: () => void}) => { applied.push(protyle.block.rootID); options.afterCB?.(); },
    });
    const navigate = (id: string, valid = () => true, afterCB = noop, append = false) => api.onGet({
        data: {code: 0, data: {id, rootID: id, box: `box-${id}`, path: `/${id}.sy`, mode: 0}},
        protyle, action: append ? ["html", "append"] : ["html"], isValid: valid, afterCB, onAVRenderError: () => failed++,
    });
    return {navigate, protyle, pending, applied, messages,
        get failed() { return failed; }, get loadingRemoved() { return loadingRemoved; }};
};

test("cross-document onGet keeps source identity and content until title saving succeeds", async () => {
    const state = setup();
    let completed = 0;
    state.navigate("next", () => true, () => completed++);
    assert.equal(state.protyle.block.rootID, "old-root");
    assert.equal(state.protyle.notebookId, "old-box");
    assert.equal(state.protyle.path, "/old.sy");
    assert.deepEqual(state.applied, []);
    state.pending[0].accept();
    await tick();
    assert.equal(state.protyle.block.rootID, "next");
    assert.equal(state.protyle.notebookId, "box-next");
    assert.deepEqual(state.applied, ["next"]);
    assert.equal(completed, 1);
});

test("failed title saving leaves the original document and reports the failure", async () => {
    const state = setup();
    state.navigate("next");
    state.pending[0].reject(new Error("Conflict"));
    await tick();
    assert.equal(state.protyle.block.rootID, "old-root");
    assert.equal(state.protyle.notebookId, "old-box");
    assert.deepEqual(state.applied, []);
    assert.deepEqual(state.messages, ["Conflict"]);
    assert.equal(state.failed, 1);
    assert.equal(state.loadingRemoved, 1);
});

test("latest navigation wins and an immediate same-document response cancels deferred navigation", async () => {
    const state = setup();
    state.navigate("first");
    state.navigate("second");
    state.pending[0].accept();
    await tick();
    assert.deepEqual(state.applied, []);
    state.pending[1].accept();
    await tick();
    assert.deepEqual(state.applied, ["second"]);
    const immediate = setup();
    immediate.navigate("later");
    immediate.navigate("old-root");
    assert.deepEqual(immediate.applied, ["old-root"]);
    immediate.pending[0].accept();
    await tick();
    assert.deepEqual(immediate.applied, ["old-root"]);
});

test("invalidated requests and detached title sessions cannot resume document replacement", async () => {
    for (const detached of [false, true]) {
        const state = setup();
        let current = true;
        state.navigate("next", () => current);
        if (detached) state.protyle.title.element.isConnected = false;
        else current = false;
        state.pending[0].accept();
        await tick();
        assert.deepEqual(state.applied, []);
        assert.equal(state.protyle.notebookId, "old-box");
        assert.equal(state.failed, 1);
    }
});

test("old document dynamic loading does not cancel an explicit navigation waiting for title saving", async () => {
    const state = setup();
    state.navigate("next");
    state.navigate("old-root", () => true, () => {}, true);
    assert.deepEqual(state.applied, ["old-root"]);
    state.pending[0].accept();
    await tick();
    assert.deepEqual(state.applied, ["old-root", "next"]);
});
