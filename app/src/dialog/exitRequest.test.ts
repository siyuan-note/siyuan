import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/dialog/exitRequest.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = () => {
    let resolve: (value: unknown) => void;
    let reject: (error: Error) => void;
    let expire: () => void;
    const requests: unknown[][] = [];
    const activeProgress = new Set(["otherProgress"]);
    const inputListeners = new Map<string, (event: Event) => void>();
    const timers = new Map<number, () => void>();
    const actions = new Map<string, () => void>();
    const confirmations: {confirm: () => void, cancel: () => void, destroyed: boolean}[] = [];
    const dialogs: {destroyed: boolean, content: {innerHTML: string}, buttons: {click?: () => void}[]}[] = [];
    const exports: any = {};
    runInNewContext(compiled, {
        exports,
        AbortController,
        window: {siyuan: {languages: {exitWaiting: "Saving",
            exitWaitFailed: "Exit could not be confirmed", close: "Close", retry: "Retry", sync: "Sync",
            skipExitSync: "Skip sync and exit", skipExitSyncConfirm: "Unsynced changes remain on this device"}},
            setTimeout: (callback: () => void, timeout: number) => {
                assert.equal(timeout, 12000);
                timers.set(1, callback);
                return 1;
            },
            clearTimeout: (timer: number) => timers.delete(timer),
            addEventListener: (type: string, listener: (event: Event) => void) => inputListeners.set(type, listener),
            removeEventListener: (type: string) => inputListeners.delete(type)},
        console: {warn: () => {}},
        require: (name: string) => {
            if (name === "./progress") return {progressLoading: (data: {code: number}, id: string,
                                                               action?: {callback: () => void}) => {
                if (data.code === 2) { activeProgress.delete(id); actions.delete(id); }
                else {
                    assert.equal(data.code, 1);
                    activeProgress.add(id);
                }
                if (action) actions.set(id, action.callback);
            }};
            if (name === "./confirmDialog") return {confirmDialog: (_title: string, text: string,
                confirm: () => void, cancel: () => void, _delete: boolean, _extra: unknown, label: string) => {
                assert.equal(label, "Skip sync and exit");
                assert.match(text, /Unsynced/);
                const confirmation = {destroyed: false, confirm, cancel: () => { confirmation.destroyed = true; cancel(); }};
                confirmations.push(confirmation);
                return {element: {contains: () => false}, destroy: confirmation.cancel};
            }};
            if (name === "../util/escape") return {escapeHtml: (value: string) => value};
            if (name === "../util/fetch") return {fetchSyncPost: (...args: unknown[]) => {
                requests.push(args);
                return new Promise((done, fail) => {
                    resolve = done; reject = fail;
                    (args[4] as AbortSignal)?.addEventListener("abort", () => fail(new Error("Aborted")), {once: true});
                });
            }};
            if (name === "../util/fetchTimeout") return {withFetchTimeout: (request: (signal: AbortSignal) => Promise<unknown>,
                                                                          signal: AbortSignal, timeout: number) => {
                assert.equal(timeout, 600000);
                return Promise.race([request(signal), new Promise((_done, fail) => {
                    expire = () => fail(new Error("Timeout"));
                })]);
            }};
            if (name === "./index") return {Dialog: class {
                state = {
                    destroyed: false,
                    buttons: [0, 1].map(() => ({
                        click: undefined as () => void,
                        addEventListener(name: string, callback: () => void) {
                            assert.equal(name, "click");
                            this.click = callback;
                        },
                        focus: () => {},
                    })),
                    content: {innerHTML: "", querySelectorAll: () => this.state.buttons},
                };
                element = {querySelectorAll: () => this.state.buttons};
                constructor(options: {content: string, disableClose: boolean}) {
                    assert.equal(options.disableClose, true);
                    this.state.content.innerHTML = options.content;
                    dialogs.push(this.state);
                }
                destroy() { this.state.destroyed = true; }
            }};
            throw new Error(name);
        },
    });
    return {request: exports.requestSystemExit as (options: unknown, response: (value: any) => void) => Promise<void>,
        requests, dialogs, activeProgress, inputListeners, timers, actions, confirmations,
        resolve: (value: unknown) => resolve(value), reject: (error: Error) => reject(error),
        expire: () => expire()};
};

test("slow exit retains endless progress and delivers success, sync failure and update confirmation", async () => {
    for (const code of [0, 1, 2]) {
        const state = fixture();
        const responses: unknown[] = [];
        const options = {force: false, setCurrentWorkspace: true};
        const pending = state.request(options, response => responses.push(response));
        assert.equal(state.request(options, () => assert.fail("duplicate exit")), pending);
        await Promise.resolve();
        assert.equal(state.dialogs.length, 0);
        assert.ok(state.activeProgress.has("exitProgress"));
        assert.equal(state.inputListeners.size, 4);
        assert.deepEqual(responses, []);
        const response = {code, msg: "", data: {installPkgPath: "update.dmg"}};
        state.resolve(response);
        await pending;
        assert.deepEqual([...state.activeProgress], ["otherProgress"]);
        assert.equal(state.inputListeners.size, 0);
        assert.deepEqual(responses, [response]);
        assert.equal(state.requests[0][0], "/api/system/exit");
        assert.equal(state.requests[0][1], options);
        assert.equal(state.requests[0][3], false);
    }
});

test("slow exit offers a choice without automatically skipping synchronization", async () => {
    const state = fixture();
    const pending = state.request({force: false, setCurrentWorkspace: true}, () => {});
    state.timers.get(1)();
    assert.equal(state.requests.length, 1);
    assert.equal(state.confirmations.length, 0);
    state.actions.get("exitProgress")();
    assert.equal(state.confirmations.length, 1);
    state.confirmations[0].cancel();
    assert.equal((state.requests[0][4] as AbortSignal).aborted, false);
    state.actions.get("exitProgress")();
    state.resolve({code: 0});
    await pending;
    assert.equal(state.confirmations[1].destroyed, true);
    assert.equal(state.timers.size, 0);
    state.confirmations[1].confirm();
    assert.equal(state.requests.length, 1, "stale confirmation started another exit");
});

test("confirmed skip cancels synchronization and waits for safe force cleanup", async () => {
    const state = fixture();
    const responses: unknown[] = [];
    const pending = state.request({force: false, setCurrentWorkspace: false}, value => responses.push(value));
    state.timers.get(1)();
    let prevented = false;
    state.inputListeners.get("keydown")({type: "keydown", key: "Tab",
        target: {closest: () => true}, preventDefault: () => { prevented = true; }} as unknown as Event);
    assert.equal(prevented, true, "Tab moved focus under the exit overlay");
    state.actions.get("exitProgress")();
    state.confirmations[0].confirm();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.requests.length, 2);
    assert.equal((state.requests[0][4] as AbortSignal).aborted, true);
    assert.equal((state.requests[1][1] as {force: boolean}).force, true);
    assert.equal((state.requests[1][1] as {setCurrentWorkspace: boolean}).setCurrentWorkspace, false);
    assert.equal((state.requests[1][1] as {execInstallPkg: number}).execInstallPkg, 1);
    assert.deepEqual(responses, []);
    assert.ok(state.activeProgress.has("exitProgress"));
    assert.equal(state.inputListeners.size, 4);
    state.resolve({code: 0});
    await pending;
    assert.equal(responses.length, 1);
    assert.equal(state.dialogs.length, 0);
    assert.equal(state.inputListeners.size, 0);
});

test("failed force cleanup stays open and retries the chosen force exit", async () => {
    const state = fixture();
    const pending = state.request({force: false, setCurrentWorkspace: true}, () => {});
    state.timers.get(1)();
    state.actions.get("exitProgress")();
    state.confirmations[0].confirm();
    await new Promise(resolve => setImmediate(resolve));
    state.reject(new Error("kernel unavailable"));
    await pending;
    assert.equal(state.dialogs.length, 1);
    state.dialogs[0].buttons[1].click();
    assert.equal((state.requests[2][1] as {force: boolean}).force, true);
    assert.equal(state.timers.size, 0);
    state.resolve({code: 0});
    await state.request({}, () => assert.fail("duplicate retry"));
});

test("network failure, timeout and invalid responses preserve the host and allow retry", async () => {
    for (const failure of ["network", "timeout", "response"]) {
        const state = fixture();
        const responses: unknown[] = [];
        const pending = state.request({force: false, setCurrentWorkspace: true}, value => responses.push(value));
        if (failure === "network") state.reject(new Error("offline"));
        else if (failure === "timeout") state.expire();
        else state.resolve({code: -1});
        await pending;
        assert.deepEqual([...state.activeProgress], ["otherProgress"]);
        assert.equal(state.inputListeners.size, 0);
        assert.equal(state.dialogs[0].destroyed, false);
        assert.match(state.dialogs[0].content.innerHTML, /Exit could not be confirmed/);
        assert.deepEqual(responses, []);
        state.dialogs[0].buttons[1].click();
        assert.equal(state.requests.length, 2);
        assert.equal(state.dialogs[0].destroyed, true);
        assert.ok(state.activeProgress.has("exitProgress"));
        state.resolve({code: 0});
        await state.request({}, () => assert.fail("duplicate retry"));
        assert.equal(responses.length, 1);
    }
});
