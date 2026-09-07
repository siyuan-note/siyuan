import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/layout/status.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const createStatus = (pendingTransactions = Promise.resolve()) => {
    const timers = new Map<number, () => void>();
    const requests: {url: string, data: Record<string, unknown>, callback: (response: unknown) => void}[] = [];
    let timerID = 0;
    const exports = {} as {
        countBlockWord: (ids: string[], context?: unknown, clearCache?: boolean) => void;
        countSelectWord: (range: {toString: () => string}, context?: unknown) => void;
        renderStatusbarCounter: (stat: unknown) => void;
    };
    const rendered: unknown[] = [];
    runInNewContext(compiled, {
        exports,
        require: () => ({
            Constants: {TIMEOUT_COUNT: 100},
            waitForPendingTransactions: () => pendingTransactions,
            fetchPost: (url: string, data: Record<string, unknown>, callback: (response: unknown) => void) => {
                requests.push({url, data, callback});
            },
        }),
        AbortController,
        clearTimeout: (id: number) => timers.delete(id),
        window: {
            setTimeout: (callback: () => void) => {
                timers.set(++timerID, callback);
                return timerID;
            },
        },
        document: {getElementById: () => ({classList: {contains: () => false}})},
        getSelection: () => ({rangeCount: 0}),
    });
    exports.renderStatusbarCounter = stat => rendered.push(stat);
    return {
        ...exports,
        requests,
        rendered,
        flush: () => {
            const callbacks = Array.from(timers.values());
            timers.clear();
            return Promise.all(callbacks.map(callback => callback()));
        },
    };
};

test("lite selection and deletion statistics never query temporary block IDs", () => {
    const status = createStatus();
    const lite = {lite: true, block: {}};
    status.countBlockWord(["temporary-block"], lite);
    status.flush();
    status.countBlockWord([], lite);
    status.countBlockWord(["restored-block"], lite, true);
    status.countSelectWord({toString: () => "draft"}, lite);
    status.flush();
    assert.equal(status.requests.length, 0);
});

test("normal editor block and text statistics remain available", async () => {
    const status = createStatus();
    const protyle = {lite: false, block: {rootID: "document"}};
    status.countBlockWord(["block"], protyle);
    await status.flush();
    assert.equal(status.requests[0].url, "/api/block/getBlocksWordCount");
    assert.deepEqual(status.requests[0].data.ids, ["block"]);
    const stat = {wordCount: 1};
    status.requests[0].callback({code: 0, data: {stat}});
    assert.deepEqual(status.rendered, [stat]);
    status.countSelectWord({toString: () => "selected text"}, protyle);
    status.flush();
    assert.equal(status.requests[1].url, "/api/block/getContentWordCount");
    assert.equal(status.requests[1].data.content, "selected text");
});

test("statistics wait for pending block creation and discard a superseded selection", async () => {
    let commit: () => void;
    const status = createStatus(new Promise<void>(resolve => commit = resolve));
    const protyle = {lite: false, block: {rootID: "document"}};
    status.countBlockWord(["first-copy"], protyle);
    const first = status.flush();
    status.countBlockWord(["second-copy"], protyle);
    const second = status.flush();
    assert.equal(status.requests.length, 0);
    commit();
    await Promise.all([first, second]);
    assert.equal(status.requests.length, 1);
    assert.deepEqual(status.requests[0].data.ids, ["second-copy"]);
});

test("statistics abandon a document switched while its transaction is pending", async () => {
    let commit: () => void;
    const status = createStatus(new Promise<void>(resolve => commit = resolve));
    const protyle = {lite: false, block: {rootID: "document"}};
    status.countBlockWord([], protyle);
    const pending = status.flush();
    protyle.block.rootID = "another-document";
    commit();
    await pending;
    assert.equal(status.requests.length, 0);
});

test("failed statistics responses do not render and document statistics can retry", () => {
    const status = createStatus();
    status.countBlockWord(["missing"]);
    status.flush();
    assert.doesNotThrow(() => status.requests[0].callback({code: -1, data: null}));
    status.countBlockWord([], "document");
    status.flush();
    assert.doesNotThrow(() => status.requests[1].callback({code: -1, data: null}));
    status.countBlockWord([], "document");
    status.flush();
    assert.equal(status.requests[2].url, "/api/block/getTreeStat");
    status.requests[2].callback({code: 0, data: {stat: {}, containsEmbed: true}});
    assert.equal(status.requests[3].data.includeEmbed, true);
    assert.doesNotThrow(() => status.requests[3].callback({code: -1, data: null}));
    assert.equal(status.rendered.length, 1);
});
