import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));
const harness = () => {
    const hidden = new Set(["fn__none"]);
    const retry = {disabled: false};
    const controls = [{disabled: false}, {disabled: true}, {disabled: false}];
    const block = {busy: "false", setAttribute(_key: string, value: string) { this.busy = value; }};
    const recovery = {classList: {add: (name: string) => hidden.add(name), remove: (name: string) => hidden.delete(name)},
        querySelector: () => retry};
    const element = {isConnected: true, dataset: {dialogClosing: "false"},
        querySelector: (selector: string) => selector === ".card__block" ? block : recovery,
        querySelectorAll: () => controls};
    const requests: Array<{url: string, data: any, success: (data?: any) => void,
        resolve: () => void, reject: (error: Error) => void, timeout?: number}> = [];
    let serial = 0;
    let next = 0;
    let ratingsEnabled = true;
    const queue = ["a", "b"].map(id => ({card: {id}, reviewState: {suspended: false},
        sessionCard: {status: "shown"}, repeatDue: undefined as number | undefined}));
    const context: Record<string, any> = {queue, sessionID: "session", sessionFinished: false,
        requestPending: false, retryManagedSkip: undefined, lastReview: {}, dialog: {element},
        genUUID: () => `operation-${++serial}`, console,
        setUndoVisible: () => {}, nextCard: () => { next++; },
        setReviewActionsEnabled: (_dialog: unknown, enabled: boolean) => {
            ratingsEnabled = enabled; block.busy = enabled ? "false" : "true";
        },
        fetchPost: (url: string, data: unknown, success: (data?: unknown) => void,
            _headers: unknown, _fail: unknown, _signal: unknown, timeout?: number) => new Promise<void>((resolve, reject) => {
            requests.push({url, data, success, resolve, reject, timeout});
        })};
    const start = source.indexOf("const updateManagedQueueCards =");
    const end = source.indexOf("const manageWithoutSkipping =", start);
    assert.ok(start > 0 && end > start);
    const globals: Record<string, any> = {...context, exports: {}};
    runInNewContext(transpileModule(`${source.slice(start, end)}\nexports.manage = manageAndSkip;`, {
        compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
    }).outputText, globals);
    return {globals, requests, element, block, retry, controls, hidden, queue,
        manage: globals.exports.manage as (ids: string[], action: string, values: object, reason: string) => void,
        get next() { return next; }, get ratingsEnabled() { return ratingsEnabled; }};
};

test("partial skip failure retries only unconfirmed identities without managing twice", async () => {
    const h = harness();
    h.manage(["a", "b"], "suspend", {}, "userSuspended");
    h.requests[0].success({data: {states: {a: {suspended: true}, b: {suspended: true}}}});
    h.requests[0].resolve();
    h.requests[1].success(); h.requests[1].resolve(); await flush();
    h.requests[2].resolve(); await flush();
    assert.equal(h.queue[0].sessionCard.status, "skipped");
    assert.equal(h.queue[1].sessionCard.status, "shown");
    assert.equal(h.globals.requestPending, true);
    assert.equal(h.ratingsEnabled, false);
    assert.equal(h.block.busy, "false");
    assert.equal(h.hidden.has("fn__none"), false);
    assert.equal(h.retry.disabled, false);
    assert.ok(h.controls.every(button => button.disabled));
    h.manage(["b"], "suspend", {}, "userSuspended");
    h.globals.retryManagedSkip(); h.globals.retryManagedSkip();
    assert.equal(h.requests.length, 4);
    assert.equal(h.requests[3].data, h.requests[2].data);
    assert.equal(h.block.busy, "true");
    h.requests[3].success(); h.requests[3].resolve(); await flush();
    assert.equal(h.next, 1);
    assert.equal(h.globals.retryManagedSkip, undefined);
    assert.deepEqual(h.controls.map(button => button.disabled), [false, true, false]);
    assert.equal(h.requests.filter(request => request.url.endsWith("manageCards")).length, 1);
});

test("transport rejection keeps independent retry available without an unhandled rejection", async () => {
    const h = harness();
    h.manage(["a"], "bury", {}, "userBuried");
    h.requests[0].success({data: {}}); h.requests[0].resolve();
    assert.equal(h.requests[1].timeout, 30000);
    h.requests[1].reject(new Error("network")); await flush();
    assert.equal(h.globals.requestPending, true);
    assert.equal(h.retry.disabled, false);
    h.globals.retryManagedSkip();
    assert.equal(h.requests[2].data, h.requests[1].data);
    h.requests[2].success(); h.requests[2].resolve(); await flush();
    assert.equal(h.next, 1);
});

test("management transport failure unlocks without starting skip recovery", async () => {
    const h = harness();
    h.manage(["a"], "suspend", {}, "userSuspended");
    h.requests[0].reject(new Error("management network")); await flush();
    assert.equal(h.globals.requestPending, false);
    assert.equal(h.globals.retryManagedSkip, undefined);
    assert.equal(h.requests.length, 1);
});

test("closing before management response does not mutate queue or start a skip", async () => {
    const h = harness();
    h.manage(["a"], "suspend", {}, "userSuspended");
    h.element.dataset.dialogClosing = "true";
    h.requests[0].success({data: {states: {a: {suspended: true}}}});
    h.requests[0].resolve(); await flush();
    assert.equal(h.queue[0].reviewState.suspended, false);
    assert.equal(h.requests.length, 1);
    assert.equal(h.globals.retryManagedSkip, undefined);
});

for (const state of ["closing", "detached", "finished"]) {
    test(`late skip response after ${state} does not change old UI or send remaining requests`, async () => {
        const h = harness();
        h.manage(["a", "b"], "suspend", {}, "sourceSuspended");
        h.requests[0].success({data: {}}); h.requests[0].resolve();
        if (state === "closing") { h.element.dataset.dialogClosing = "true"; }
        if (state === "detached") { h.element.isConnected = false; }
        if (state === "finished") { h.globals.sessionFinished = true; }
        h.requests[1].success(); h.requests[1].resolve(); await flush();
        h.globals.retryManagedSkip();
        assert.equal(h.requests.length, 2);
        assert.equal(h.next, 0);
        assert.equal(h.queue[0].sessionCard.status, "shown");
        assert.equal(h.hidden.has("fn__none"), true);
        assert.equal(h.retry.disabled, true);
    });
}

test("recovery markup and click branch expose retry outside ordinary review eligibility", () => {
    assert.match(source, /data-flashcard-skip-recovery[^>]+role="status"/);
    assert.match(source, /data-type="retry-skip" class="b3-button b3-button--outline"/);
    const start = source.indexOf("if (target.closest('[data-type=\"retry-skip\"]'))");
    assert.ok(start > 0);
    const code = source.slice(start, source.indexOf("if (target.closest", start + 10));
    assert.match(code, /retryManagedSkip\?\.\(\)/);
    assert.doesNotMatch(code, /canUseReviewActions|requestPending/);
    let retried = 0;
    runInNewContext(`(() => {${code}})()`, {
        target: {closest: () => true}, requestPending: true,
        canUseReviewActions: () => false, retryManagedSkip: () => retried++,
    });
    assert.equal(retried, 1);
});
