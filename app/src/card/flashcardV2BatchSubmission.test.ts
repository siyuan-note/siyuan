import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";
import {escapeHtml} from "../util/escape";

const harness = () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const start = source.indexOf('if (type === "batchApply") {');
    const end = source.indexOf("if (!item)", start);
    const form = readFileSync("src/card/flashcardV2Form.ts", "utf8");
    const operation = form.slice(form.indexOf("export const createFlashcardV2Operation"),
        form.indexOf("// 展开错误字段")).replace("export const", "const");
    let serial = 0;
    let refreshed = 0;
    let errors = 0;
    const requests: Array<{payload: Record<string, unknown>, complete: (saved: boolean, msg?: string) => void}> = [];
    const messages: string[] = [];
    const confirms: Array<{accept: () => void, cancel: () => void}> = [];
    const owner: {batchPending?: symbol, refreshBatch?: () => void} = {};
    const element = {isConnected: true, dataset: {dialogClosing: "false"}};
    const signal = {aborted: false};
    const selectedCardIDs = new Set(["a", "b"]);
    const context = {
        owner, dialog: {element}, listenerOptions: {signal}, selectedCardIDs,
        cards: [{card: {id: "a"}}, {card: {id: "b"}}], batchAction: "setFlag:2", type: "batchApply",
        genUUID: () => `operation-${++serial}`, Date, Symbol, escapeHtml,
        window: {siyuan: {languages: {reset: "reset", resetCardTip: "Reset ${x}", flashcardSaveFailed: "failed"}}},
        reloadPage: () => { refreshed++; }, showMessage: (message: string) => { errors++; messages.push(message); },
        confirmDialog: ({confirm, cancel}: {confirm: () => void, cancel: () => void}) => {
            confirms.push({accept: confirm, cancel});
        },
        withFetchTimeout: (request: () => Promise<unknown>, _signal: unknown, timeout: number) => {
            assert.equal(timeout, 30000);
            return request();
        },
        fetchSyncPost: (_url: string, payload: Record<string, unknown>, _headers: unknown, process: boolean) => new Promise((resolve) => {
            assert.equal(process, false);
            requests.push({payload, complete: (saved: boolean, msg = "") => resolve({code: saved ? 0 : -1, msg})});
        }),
    };
    const script = transpileModule(operation + "\nconst apply = () => {" + source.slice(start, end) + "}; apply;",
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const apply = runInNewContext(script, context) as () => void;
    return {apply, context, owner, requests, confirms, element, signal, selectedCardIDs, messages,
        refreshed: () => refreshed, errors: () => errors};
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("batch clicks serialize, failed payload retries identity and preserves selection", async () => {
    const h = harness();
    h.apply(); h.apply();
    assert.equal(h.requests.length, 1);
    assert.ok(h.owner.batchPending);
    h.requests[0].complete(false);
    await tick();
    assert.equal(h.owner.batchPending, undefined);
    assert.deepEqual([...h.selectedCardIDs], ["a", "b"]);
    assert.equal(h.errors(), 1);
    h.apply();
    assert.deepEqual(h.requests[1].payload, h.requests[0].payload);
    h.requests[1].complete(true);
    await tick();
    assert.equal(h.refreshed(), 1);
    h.apply();
    assert.notEqual(h.requests[2].payload.operationID, h.requests[1].payload.operationID);
    h.requests[2].complete(true);
    await tick();
});

test("reset confirmation owns lock, cancel releases, repeated accept submits once", async () => {
    const h = harness();
    h.context.batchAction = "reset";
    h.apply(); h.apply();
    assert.equal(h.confirms.length, 1);
    assert.equal(h.requests.length, 0);
    h.confirms[0].cancel();
    assert.equal(h.owner.batchPending, undefined);
    assert.equal(h.errors(), 0);
    h.apply();
    h.confirms[1].accept(); h.confirms[1].accept();
    assert.equal(h.requests.length, 1);
    h.confirms[0].cancel();
    assert.ok(h.owner.batchPending, "old cancel must not unlock a new attempt");
    h.requests[0].complete(true);
    await tick();
    assert.equal(h.owner.batchPending, undefined);
});

test("closed or replaced management does not submit old confirmation or revive on response", async () => {
    for (const aborted of [false, true]) {
        const h = harness();
        h.context.batchAction = "reset";
        h.apply();
        if (aborted) { h.signal.aborted = true; } else { h.element.dataset.dialogClosing = "true"; }
        h.confirms[0].accept();
        await tick();
        assert.equal(h.requests.length, 0);
        assert.equal(h.owner.batchPending, undefined);
    }
    for (const saved of [false, true]) {
        const h = harness();
        h.apply();
        h.element.isConnected = false;
        h.requests[0].complete(saved);
        await tick();
        assert.equal(h.refreshed(), 0);
        assert.equal(h.errors(), 0);
    }
});

test("selection refresh and batch menu cannot bypass a pending request", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    assert.match(source, /batchMenu.disabled = Boolean\(owner.batchPending\)/);
    assert.match(source, /batchApply.disabled = Boolean\(owner.batchPending\)/);
    assert.match(source, /if \(type === "batchMenu"\) \{\s+if \(owner.batchPending\) \{ return; \}/);
});

test("a page rebind keeps the owner lock then refreshes the latest live page on success", async () => {
    const h = harness();
    let latestControls = 0;
    h.apply();
    h.signal.aborted = true;
    h.owner.refreshBatch = () => { latestControls++; };
    h.apply();
    assert.equal(h.requests.length, 1);
    h.requests[0].complete(true);
    await tick();
    assert.equal(h.refreshed(), 1);
    assert.equal(latestControls, 1);
    assert.equal(h.owner.batchPending, undefined);
});

test("changing selected cards after failure creates a different operation", async () => {
    const h = harness();
    h.apply();
    h.requests[0].complete(false);
    await tick();
    h.selectedCardIDs.delete("b");
    h.apply();
    assert.notEqual(h.requests[0].payload.operationID, h.requests[1].payload.operationID);
    assert.deepEqual(Array.from(h.requests[1].payload.cardIDs as string[]), ["a"]);
    h.requests[1].complete(true);
    await tick();
});

test("server failure displays its specific message once and escapes markup", async () => {
    const h = harness();
    h.apply();
    h.requests[0].complete(false, "Invalid <preset>");
    await tick();
    assert.deepEqual(h.messages, [escapeHtml("Invalid <preset>")]);
    assert.equal(h.owner.batchPending, undefined);
});
