import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../../../testSupport/loadModule";
import {DOMFixture} from "./testDOM";
import type {AVAutomationRunResult} from "../../../types/api";

const report = (values: Partial<AVAutomationRunResult> = {}): AVAutomationRunResult => ({runID: "run", step: 0, total: 1,
    succeeded: [], failed: [], pending: ["row"], skipped: [], paused: "", running: false, ...values});
type Response = {code: number; msg?: string; data?: AVAutomationRunResult};
const tick = () => new Promise(resolve => setImmediate(resolve));

const fixture = (pendingEdits = false) => {
    const document = new DOMFixture();
    const block = document.createElement("div");
    block.dataset.avId = "database";
    block.dataset.nodeId = "carrier";
    const host = document.createElement("div");
    host.innerHTML = "<button data-run></button><input disabled><span data-status></span>";
    block.append(host);
    document.body.append(block);
    const button = host.querySelector("button") as unknown as HTMLButtonElement;
    const input = host.querySelector("input") as unknown as HTMLInputElement;
    const status = host.querySelector("span") as unknown as HTMLElement;
    const query = host.querySelectorAll.bind(host);
    Object.defineProperty(host, "querySelectorAll", {value: (selector: string) =>
        selector.includes(",") ? selector.split(",").flatMap(value => Array.from(query(value.trim()))) : query(selector)});
    const protyle = {disabled: false, options: {}, block: {rootID: "document"}} as IProtyle;
    const requests: Array<{url: string; data: Record<string, unknown>}> = [];
    const pending: Array<{resolve: (value: Response) => void; reject: (error: Error) => void}> = [];
    const mirrors: string[] = [];
    const controller = new AbortController();
    const clock = {now: Date.now()};
    let disposed = false;
    let finishEdits: () => void;
    const edits = pendingEdits ? new Promise<void>(resolve => { finishEdits = resolve; }) : Promise.resolve();
    const api = loadModule<typeof import("./manualAutomation")>("src/protyle/render/av/manualAutomation.ts", {
        document, Date: {now: () => clock.now}, window: {siyuan: {config: {}, languages: {loading: "Loading", templateHTTPFailed: "HTTP failed",
            automationRunSummary: "${succeeded} saved, ${failed} failed, ${pending} pending, ${skipped} skipped",
            automationRunUnconfirmed: "Unconfirmed", automationCheckProgress: "Check progress", automationRunAll: "Run all",
            automationRetryRemaining: "Retry remaining", automationFailedItems: "Failed entries", automationRunBudget: "Budget reached",
            automationRunStopped: "Stopped", automationRunChanged: "Rule changed", automationRunExpired: "Expired"}}},
        require: (name: string) => {
            if (name.endsWith("/fetch")) return {fetchSyncPost: (url: string, data: Record<string, unknown>) => {
                requests.push({url, data: JSON.parse(JSON.stringify(data))});
                return new Promise<Response>((resolve, reject) => pending.push({resolve, reject}));
            }};
            if (name.endsWith("/http")) return {guardTemplateHTTPRequest: (_current: () => boolean, owner: Element) => {
                assert.equal(owner, block);
                return {signal: controller.signal, dispose: () => { disposed = true; }};
            }};
            if (name.endsWith("/transactionQueue")) return {waitForPendingTransactions: () => edits};
            if (name.endsWith("/globalUndo")) return {initMirror: async (id: string) => { mirrors.push(id); }, refreshUndoButtons() {}};
            throw new Error(name);
        },
    });
    return {run: (action?: "start" | "retry" | "status" | "restart") => api.runManualAutomation(protyle, block as unknown as HTMLElement,
        host as unknown as HTMLElement, "rule", button, status, action), host, button, input, status, protyle, requests, mirrors,
        respond: (value: Response) => { assert.ok(pending.length); pending.shift().resolve(value); },
        reject: () => { assert.ok(pending.length); pending.shift().reject(new Error("lost response")); },
        controller, disposed: () => disposed, finishEdits: () => finishEdits(), expire: () => { clock.now += 16 * 60 * 1000; }};
};

test("manual row execution waits for saved edits, starts without writes and continues with an exact step", async () => {
    const f = fixture(true);
    const work = f.run();
    await tick();
    assert.equal(f.requests.length, 0);
    f.finishEdits();
    await tick();
    assert.equal(f.button.disabled, true);
    assert.equal(f.host.getAttribute("aria-busy"), "true");
    assert.deepEqual(f.requests[0].data, {avID: "database", blockID: "carrier", ruleID: "rule", rows: true, action: "start"});
    f.respond({code: 0, data: report()});
    await tick();
    assert.equal(f.requests[1].data.action, "run");
    assert.equal(f.requests[1].data.runID, "run");
    assert.equal(f.requests[1].data.step, 0);
    f.respond({code: 0, data: report({step: 1, succeeded: ["row"], pending: []})});
    await work;
    assert.match(f.status.textContent, /1 saved, 0 failed, 0 pending/);
    assert.deepEqual(f.mirrors, ["document"]);
    assert.equal(f.button.disabled, false);
    assert.equal(f.input.disabled, true);
    assert.equal(f.host.hasAttribute("aria-busy"), false);
    assert.equal(f.disposed(), true);
});

test("partial results remain visible and retry uses the existing progress without restarting successful rows", async () => {
    const f = fixture();
    const work = f.run();
    await tick();
    f.respond({code: 0, data: report({total: 2, pending: ["row", "failed"]})});
    await tick();
    f.respond({code: 1, data: report({step: 1, total: 2, succeeded: ["row"], failed: [{itemID: "failed", code: "http_status"}], pending: []})});
    await work;
    assert.match(f.status.textContent, /1 saved, 1 failed/);
    const retry = f.run("retry");
    await tick();
    assert.equal(f.requests.at(-1).data.action, "retry");
    assert.equal(f.requests.at(-1).data.runID, "run");
    assert.equal(f.requests.at(-1).data.step, 1);
    f.respond({code: 0, data: report({step: 2, total: 2, succeeded: ["row", "failed"], pending: []})});
    await retry;
    assert.match(f.status.textContent, /2 saved, 0 failed/);
});

test("lost write responses query progress without replaying actions and leave unconfirmed results queryable", async () => {
    const f = fixture();
    const work = f.run();
    await tick(); f.respond({code: 0, data: report()});
    await tick(); f.reject();
    await tick();
    assert.equal(f.requests[2].data.action, "status");
    f.reject();
    await work;
    assert.match(f.status.textContent, /Unconfirmed/);
    const count = f.requests.length;
    await f.run();
    assert.equal(f.requests.length, count, "a normal click cannot silently restart an unconfirmed run");
    const check = f.run("status");
    await tick();
    f.respond({code: 0, data: report({step: 1, succeeded: ["row"], pending: []})});
    await check;
    assert.match(f.status.textContent, /1 saved, 0 failed/);
    assert.equal(f.requests.filter(request => request.data.action === "run").length, 1);
});

test("expired local progress cannot turn retry into a fresh whole-run execution", async () => {
    const f = fixture();
    const work = f.run();
    await tick(); f.respond({code: 0, data: report()});
    await tick(); f.respond({code: 1, data: report({step: 1, failed: [{itemID: "row", code: "failed"}], pending: []})});
    await work;
    f.expire();
    await f.run("retry");
    assert.equal(f.requests.length, 2);
    assert.equal(f.status.textContent, "Expired");
    await f.run("status");
    assert.equal(f.requests.length, 2);
});

test("closed and readonly editors cannot continue row execution; expired progress is not recreated", async () => {
    const f = fixture();
    f.protyle.disabled = true;
    await f.run();
    assert.equal(f.requests.length, 0);
    f.protyle.disabled = false;
    const work = f.run();
    await tick(); f.host.remove(); f.respond({code: 0, data: report()});
    await work;
    assert.equal(f.requests.length, 1);
    assert.equal(f.mirrors.length, 0);
    const expired = fixture();
    const attempt = expired.run();
    await tick(); expired.respond({code: 0, data: report()});
    await tick(); expired.respond({code: -409});
    await attempt;
    assert.equal(expired.requests.length, 2);
    assert.equal(expired.status.textContent, "Expired");
});
