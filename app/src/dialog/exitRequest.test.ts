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
    const dialogs: {destroyed: boolean, content: {innerHTML: string}, buttons: {click?: () => void}[]}[] = [];
    const exports: any = {};
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {languages: {exitWaiting: "Saving",
            exitWaitFailed: "Exit could not be confirmed", close: "Close", retry: "Retry"}},
            addEventListener: (type: string, listener: (event: Event) => void) => inputListeners.set(type, listener),
            removeEventListener: (type: string) => inputListeners.delete(type)},
        console: {warn: () => {}},
        require: (name: string) => {
            if (name === "./progress") return {progressLoading: (data: {code: number}, id: string) => {
                if (data.code === 2) activeProgress.delete(id);
                else {
                    assert.equal(data.code, 1);
                    activeProgress.add(id);
                }
            }};
            if (name === "../util/escape") return {escapeHtml: (value: string) => value};
            if (name === "../util/fetch") return {fetchSyncPost: (...args: unknown[]) => {
                requests.push(args);
                return new Promise((done, fail) => { resolve = done; reject = fail; });
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
        requests, dialogs, activeProgress, inputListeners,
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
