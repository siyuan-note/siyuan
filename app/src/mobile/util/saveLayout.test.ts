import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {setImmediate} from "node:timers";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const constants = {LOCAL_MOBILE_TABS: "local-mobile-tabs", LOCAL_FILEPOSITION: "local-fileposition"};
const source = (path: string) => transpileModule(readFileSync(join(__dirname, path), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
}).outputText;
const layoutSource = source("saveLayout.ts");
const timeoutSource = source("../../util/fetchTimeout.ts");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

type StorageRequest = {
    key: string;
    value: unknown;
    callback: () => void;
    timeout: number;
    resolve: () => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
};

const loadLayout = (timedRequests = false) => {
    let now = 0;
    let timerID = 0;
    const timers = new Map<number, {at: number, callback: () => void}>();
    const timeoutAPI = {} as typeof import("../../util/fetchTimeout");
    runInNewContext(timeoutSource, {
        exports: timeoutAPI,
        AbortController,
        DOMException,
        setTimeout: (callback: () => void, delay: number) => {
            timers.set(++timerID, {at: now + delay, callback});
            return timerID;
        },
        clearTimeout: (id: number) => timers.delete(id),
    });
    const requests: StorageRequest[] = [];
    const warnings: unknown[][] = [];
    const scrollCalls: {protyle: IProtyle, force: boolean}[] = [];
    const state = {
        config: {readonly: false},
        isPublish: false,
        mobile: {} as {tabs?: {save: () => Promise<boolean>}, editor?: {protyle: IProtyle}},
        storage: {[constants.LOCAL_FILEPOSITION]: {} as Record<string, unknown>},
    };
    const controls = {
        scroll: {id: "visible-block", top: 42} as unknown,
        storageError: undefined as Error | undefined,
    };
    const api = {} as typeof import("./saveLayout");
    const modules: Record<string, unknown> = {
        "../../constants": {Constants: constants},
        "../../protyle/scroll/saveScroll": {saveScroll: (protyle: IProtyle, force: boolean) => {
            scrollCalls.push({protyle, force});
            return controls.scroll;
        }},
        "../../protyle/util/compatibility": {setStorageVal: (
            key: string, value: unknown, callback: () => void, timeout: number,
        ) => {
            if (controls.storageError) {
                throw controls.storageError;
            }
            let resolve: () => void;
            let reject: (error: Error) => void;
            const promise = new Promise<void>((resolvePromise, rejectPromise) => {
                resolve = resolvePromise;
                reject = rejectPromise;
            });
            const request = {key, value, callback, timeout, resolve, reject} as StorageRequest;
            requests.push(request);
            return timedRequests ? timeoutAPI.withFetchTimeout((signal) => {
                request.signal = signal;
                return promise;
            }, undefined, timeout).catch(() => {}) : promise;
        }},
        "../../util/pathName": {isEncryptedBox: (id: string) => id === "encrypted-box"},
        "../../util/fetchTimeout": timeoutAPI,
    };
    runInNewContext(layoutSource, {
        exports: api,
        require: (name: string) => {
            assert.ok(name in modules, name);
            return modules[name];
        },
        window: {siyuan: state},
        console: {warn: (...args: unknown[]) => warnings.push(args)},
    });
    const advance = async (milliseconds: number) => {
        const end = now + milliseconds;
        await flush();
        while (true) {
            const next = Array.from(timers.entries()).filter(([, timer]) => timer.at <= end)
                .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (!next) {
                break;
            }
            now = next[1].at;
            timers.delete(next[0]);
            next[1].callback();
            await flush();
        }
        now = end;
    };
    return {api, state, controls, requests, warnings, scrollCalls, timers, advance};
};

const succeed = (request: StorageRequest) => {
    request.callback();
    request.resolve();
};
const editor = (notebookId = "public-box") => ({
    protyle: {notebookId, block: {rootID: "document"}} as IProtyle,
});
const entry = (id: string) => ({
    id, rootID: id, notebookID: "public-box", path: `/${id}.sy`, title: id,
    action: ["cb-get-scroll"], scroll: {id: `${id}-block`, top: 10},
});
const tabsState = () => ({
    version: 1,
    activeTabID: "tab-1",
    tabs: [{id: "tab-1", current: entry("current"), backStack: [entry("back")],
        forwardStack: [entry("forward")], activeAt: 100}],
    activationBackStack: ["tab-2"],
    activationForwardStack: ["tab-3"],
});

test("mobile storage snapshots nested tab data synchronously and writes snapshots in FIFO order", async () => {
    const {api, requests} = loadLayout();
    const state = tabsState();
    const firstSnapshot = clone(state);
    const first = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, state);
    state.tabs[0].current.action.push("cb-get-focus");
    state.tabs[0].current.scroll.top = 20;
    state.tabs[0].backStack[0].action.push("cb-get-focus");
    state.tabs[0].backStack[0].scroll.top = 30;
    state.tabs[0].forwardStack[0].scroll.top = 40;
    state.activationBackStack.push("tab-4");
    state.activationForwardStack.splice(0, 1);
    const secondSnapshot = clone(state);
    const second = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, state);
    state.tabs[0].current.action.length = 0;
    state.tabs[0].backStack.length = 0;
    state.tabs[0].forwardStack[0].action.length = 0;
    state.tabs[0].forwardStack.length = 0;
    state.tabs[0].current.scroll.top = 90;
    state.activationBackStack.length = 0;
    state.activationForwardStack.push("tab-5");
    const thirdSnapshot = clone(state);
    const third = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, state);
    state.tabs.length = 0;
    state.activationForwardStack.length = 0;
    assert.equal(requests.length, 1);
    assert.deepEqual(clone(requests[0].value), firstSnapshot);
    succeed(requests[0]);
    assert.equal(await first, true);
    await flush();
    assert.equal(requests.length, 2);
    assert.deepEqual(clone(requests[1].value), secondSnapshot);
    succeed(requests[1]);
    assert.equal(await second, true);
    await flush();
    assert.equal(requests.length, 3);
    assert.deepEqual(clone(requests[2].value), thirdSnapshot);
    succeed(requests[2]);
    assert.equal(await third, true);
    assert.ok(requests.every(request => request.timeout === 10000));
});

test("a success callback does not settle storage or release its queue before the request settles", async () => {
    const {api, requests} = loadLayout();
    let settled = false;
    const first = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {revision: 1});
    void first.then(() => { settled = true; });
    const second = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {revision: 2});
    requests[0].callback();
    await flush();
    assert.equal(settled, false);
    assert.equal(requests.length, 1);
    requests[0].resolve();
    assert.equal(await first, true);
    await flush();
    assert.equal(requests.length, 2);
    succeed(requests[1]);
    assert.equal(await second, true);
});

test("a consumed request failure reports false and does not block the next snapshot", async () => {
    const {api, requests} = loadLayout();
    const first = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {revision: 1});
    const second = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {revision: 2});
    requests[0].resolve();
    assert.equal(await first, false);
    requests[0].callback();
    assert.equal(await first, false);
    await flush();
    assert.equal(requests.length, 2);
    succeed(requests[1]);
    assert.equal(await second, true);
});

test("a rejected request reports false and does not poison the tab storage queue", async () => {
    const {api, requests, warnings} = loadLayout();
    const first = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {revision: 1});
    const second = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {revision: 2});
    requests[0].reject(new Error("offline"));
    assert.equal(await first, false);
    assert.equal(warnings.length, 1);
    await flush();
    succeed(requests[1]);
    assert.equal(await second, true);
});

test("a storage callback followed by request rejection still reports failure", async () => {
    const {api, requests} = loadLayout();
    const saving = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {});
    requests[0].callback();
    requests[0].reject(new Error("response processing failed"));
    assert.equal(await saving, false);
});

test("a synchronous storage exception reports failure and permits a later save", async () => {
    const {api, requests, controls} = loadLayout();
    controls.storageError = new Error("request setup failed");
    assert.equal(await api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {}), false);
    controls.storageError = undefined;
    const saving = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {revision: 2});
    await flush();
    assert.equal(requests.length, 1);
    succeed(requests[0]);
    assert.equal(await saving, true);
});

test("legacy position writes start immediately even while tab and position writes are pending", async () => {
    const {api, requests} = loadLayout();
    const first = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {revision: 1});
    const second = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {revision: 2});
    const positions = {document: {id: "block", top: 10}};
    const legacyFirst = api.saveMobileStorage(constants.LOCAL_FILEPOSITION, positions);
    positions.document.top = 20;
    const legacySecond = api.saveMobileStorage(constants.LOCAL_FILEPOSITION, positions);
    positions.document.top = 30;
    assert.deepEqual(requests.map(request => request.key), [
        constants.LOCAL_MOBILE_TABS, constants.LOCAL_FILEPOSITION, constants.LOCAL_FILEPOSITION,
    ]);
    assert.deepEqual(clone(requests[1].value), {document: {id: "block", top: 10}});
    assert.deepEqual(clone(requests[2].value), {document: {id: "block", top: 20}});
    requests.forEach(succeed);
    assert.deepEqual(await Promise.all([first, legacyFirst, legacySecond]), [true, true, true]);
    await flush();
    assert.equal(requests.length, 4);
    succeed(requests[3]);
    assert.equal(await second, true);
});

test("readonly and published storage saves succeed without cloning or sending data", async () => {
    for (const mode of ["readonly", "publish"]) {
        const {api, state, requests} = loadLayout();
        state.config.readonly = mode === "readonly";
        state.isPublish = mode === "publish";
        const circular: {self?: unknown} = {};
        circular.self = circular;
        assert.equal(await api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, circular), true);
        assert.equal(await api.saveMobileStorage(constants.LOCAL_FILEPOSITION, circular), true);
        assert.equal(requests.length, 0);
    }
});

test("layout save calls the tab saver synchronously and awaits its result", async () => {
    const {api, state, requests, scrollCalls, timers} = loadLayout();
    const snapshot = tabsState();
    state.mobile.editor = editor();
    let calls = 0;
    state.mobile.tabs = {save: () => {
        calls++;
        return api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, snapshot);
    }};
    const saving = api.saveMobileLayout();
    assert.equal(calls, 1);
    assert.equal(requests.length, 1);
    snapshot.tabs[0].current.scroll.top = 99;
    assert.equal((clone(requests[0].value) as typeof snapshot).tabs[0].current.scroll.top, 10);
    assert.equal(scrollCalls.length, 0);
    succeed(requests[0]);
    assert.equal(await saving, true);
    assert.equal(timers.size, 0);
});

test("layout save preserves a false tab result and converts thrown or rejected tab saves to false", async () => {
    for (const failure of ["false", "throw", "reject"]) {
        const {api, state, timers} = loadLayout();
        state.mobile.tabs = {save: () => {
            if (failure === "throw") {
                throw new Error("snapshot failed");
            }
            return failure === "reject" ? Promise.reject(new Error("save failed")) : Promise.resolve(false);
        }};
        assert.equal(await api.saveMobileLayout(), false);
        assert.equal(timers.size, 0);
    }
});

test("blank layouts and editors without a scroll snapshot need no storage write", async () => {
    const {api, state, controls, requests, scrollCalls} = loadLayout();
    assert.equal(await api.saveMobileLayout(), true);
    assert.equal(scrollCalls.length, 0);
    state.mobile.editor = editor();
    controls.scroll = undefined;
    assert.equal(await api.saveMobileLayout(), true);
    assert.equal(scrollCalls.length, 1);
    assert.equal(requests.length, 0);
});

test("legacy layout capture saves the current scroll synchronously and preserves other positions", async () => {
    const {api, state, controls, requests, scrollCalls} = loadLayout();
    state.mobile.editor = editor();
    state.storage[constants.LOCAL_FILEPOSITION].other = {id: "other-block", top: 15};
    const saving = api.saveMobileLayout();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].key, constants.LOCAL_FILEPOSITION);
    assert.equal(scrollCalls[0].protyle, state.mobile.editor.protyle);
    assert.equal(scrollCalls[0].force, true);
    assert.deepEqual(clone(requests[0].value), {
        document: {id: "visible-block", top: 42}, other: {id: "other-block", top: 15},
    });
    assert.equal(state.storage[constants.LOCAL_FILEPOSITION].document, controls.scroll);
    (controls.scroll as {top: number}).top = 100;
    state.mobile.editor = editor("other-box");
    assert.equal((clone(requests[0].value) as {document: {top: number}}).document.top, 42);
    succeed(requests[0]);
    assert.equal(await saving, true);
});

test("encrypted legacy layout capture removes its global position before persisting", async () => {
    const {api, state, requests, scrollCalls} = loadLayout();
    state.mobile.editor = editor("encrypted-box");
    const positions = state.storage[constants.LOCAL_FILEPOSITION];
    positions.document = {id: "secret-block", top: 80};
    positions.other = {id: "public-block", top: 15};
    const saving = api.saveMobileLayout();
    assert.equal(scrollCalls.length, 1);
    assert.equal(scrollCalls[0].force, true);
    assert.equal(Object.prototype.hasOwnProperty.call(positions, "document"), false);
    assert.equal(requests.length, 1);
    assert.deepEqual(clone(requests[0].value), {other: {id: "public-block", top: 15}});
    succeed(requests[0]);
    assert.equal(await saving, true);
});

test("legacy layout saves report consumed storage failures", async () => {
    const {api, state, requests} = loadLayout();
    state.mobile.editor = editor();
    const saving = api.saveMobileLayout();
    requests[0].resolve();
    assert.equal(await saving, false);
});

test("the aggregate deadline bounds a queued layout save without letting later writes overtake it", async () => {
    const {api, state, requests, advance, timers} = loadLayout(true);
    const first = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {revision: 1});
    const second = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {revision: 2});
    state.mobile.tabs = {save: () => api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {revision: 3})};
    let settled = false;
    const layout = api.saveMobileLayout();
    void layout.then(() => { settled = true; });
    await advance(9999);
    assert.equal(settled, false);
    assert.equal(requests.length, 1);
    await advance(1);
    assert.equal(await first, false);
    assert.equal(await layout, false);
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(requests.length, 2);
    assert.deepEqual(clone(requests[1].value), {revision: 2});
    const fourth = api.saveMobileStorage(constants.LOCAL_MOBILE_TABS, {revision: 4});
    await advance(10000);
    assert.equal(await second, false);
    assert.equal(requests.length, 3);
    assert.deepEqual(clone(requests[2].value), {revision: 3});
    succeed(requests[2]);
    await flush();
    assert.equal(requests.length, 4);
    assert.deepEqual(clone(requests[3].value), {revision: 4});
    succeed(requests[3]);
    assert.equal(await fourth, true);
    assert.equal(timers.size, 0);
});

test("an unresponsive tab saver is bounded by the layout deadline", async () => {
    const {api, state, advance, timers} = loadLayout();
    state.mobile.tabs = {save: () => new Promise<boolean>(() => {})};
    const saving = api.saveMobileLayout();
    await advance(10000);
    assert.equal(await saving, false);
    assert.equal(timers.size, 0);
});
