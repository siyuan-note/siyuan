import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../../../testSupport/loadModule";

const fixture = () => {
    const timers = new Map<number, () => Promise<void>>();
    const listeners = new Map<string, () => void>();
    const owner = {isConnected: true, hidden: false, editable: true, closest: (selector: string) =>
        selector === ".fn__none" ? owner.hidden ? {} : null : owner.editable ? {} : null};
    const siyuan = {config: {readonly: false}, isPublish: false, languages: {templateHTTPFailed: "failed"},
        ws: {ws: {addEventListener: (name: string, callback: () => void) => listeners.set(name, callback)}}};
    const requests: Array<{url: string; data: unknown; signal: AbortSignal; finish: (value: {code: number; msg?: string}) => void}> = [];
    const guards: Array<{controller: AbortController; disposed: boolean}> = [];
    const messages: string[] = [];
    let next = 0;
    const module = loadModule<typeof import("./automaticHTTP")>("src/protyle/render/av/automaticHTTP.ts", {
        window: {siyuan}, CSS: {escape: String}, AbortController,
        document: {querySelectorAll: () => [owner]},
        setTimeout: (callback: () => Promise<void>, delay: number) => {assert.equal(delay, 150); timers.set(++next, callback); return next;},
        clearTimeout: (id: number) => timers.delete(id),
        require: (name: string) => {
            if (name.endsWith("/fetch")) return {fetchSyncPost: (url: string, data: unknown, _headers: unknown, _process: boolean, signal: AbortSignal) =>
                new Promise(resolve => requests.push({url, data, signal, finish: resolve}))};
            if (name.endsWith("/message")) return {showMessage: (message: string) => messages.push(message)};
            if (name.endsWith("/http")) return {getTemplateHTTPWindow: () => ({app: "app", session: "main"}),
                guardTemplateHTTPRequest: (_current: () => boolean, element: unknown) => {
                    assert.equal(element, owner);
                    const guard = {controller: new AbortController(), disposed: false};
                    guards.push(guard);
                    return {signal: guard.controller.signal, cancel: () => guard.controller.abort(), dispose: () => {guard.disposed = true;}};
                }};
            throw new Error(name);
        },
    });
    const schedule = (sequence: number, id = `job-${sequence}`) => module.scheduleAutomaticHTTP([{id, sequence, avID: "database", blockID: "carrier"}]);
    const fire = () => {const pending = [...timers.values()]; timers.clear(); return Promise.all(pending.map(callback => callback()));};
    return {schedule, fire, timers, requests, messages, owner, siyuan, guards, listeners};
};

test("automatic HTTP coalesces newer jobs and ignores late responses even after completion", async () => {
    const f = fixture();
    f.schedule(1);
    f.schedule(2);
    assert.equal(f.timers.size, 1);
    assert.equal(f.guards[0].controller.signal.aborted, true);
    const run = f.fire();
    assert.equal(f.requests.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].data)), {avID: "database", blockID: "carrier", ruleID: "", jobID: "job-2"});
    f.requests[0].finish({code: 0});
    await run;
    f.schedule(1);
    f.schedule(2);
    assert.equal(f.timers.size, 0);
    assert.equal(f.messages.length, 0);
    assert.equal(f.guards[1].disposed, true);
});

test("new edits cancel running requests without reporting superseded results", async () => {
    const f = fixture();
    f.schedule(1);
    const first = f.fire();
    f.schedule(2);
    assert.equal(f.requests[0].signal.aborted, true);
    f.requests[0].finish({code: -1, msg: "obsolete"});
    await first;
    const second = f.fire();
    f.requests[1].finish({code: -409});
    await second;
    assert.equal(f.messages.length, 0);
});

test("closed, hidden, history and readonly editors cannot start queued HTTP", async () => {
    for (const mode of ["hidden", "history", "readonly", "closed"]) {
        const f = fixture();
        if (mode === "hidden") f.owner.hidden = true;
        if (mode === "history") f.owner.editable = false;
        if (mode === "readonly") f.siyuan.config.readonly = true;
        f.schedule(1);
        if (mode === "closed") f.owner.isConnected = false;
        await f.fire();
        assert.equal(f.requests.length, 0, mode);
    }
});

test("disconnect cancels work and resets ordering for a restarted kernel", async () => {
    const f = fixture();
    f.schedule(5);
    const first = f.fire();
    f.listeners.get("close")();
    assert.equal(f.requests[0].signal.aborted, true);
    f.requests[0].finish({code: 0});
    await first;
    f.schedule(1);
    const next = f.fire();
    f.requests[1].finish({code: -1, msg: "failed"});
    await next;
    assert.deepEqual(f.messages, ["failed"]);
});
