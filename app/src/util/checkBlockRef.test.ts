import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const source = transpileModule(readFileSync("src/util/checkBlockRef.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;
const blocks: import("./checkBlockRef").IBlockRefCheckOptions = {scope: "blocks", ids: ["block"], deletedIDs: ["block"]};

const setup = (pendingTransactions = Promise.resolve()) => {
    const api = {} as typeof import("./checkBlockRef");
    const timers = new Map<number, () => void>();
    const messages: string[] = [];
    const requests: {signal: AbortSignal, respond: (data: boolean) => void}[] = [];
    const progressID = "checkBlockRefProgress";
    let timerID = 0;
    let cancel: (() => void) | undefined;
    let confirmations = 0;
    class FocusTarget {
        isConnected = true;
        focus() { document.activeElement = this; }
    }
    const editor = new FocusTarget();
    const button = new FocusTarget();
    const document = {
        activeElement: editor,
        getElementById: (id: string) => id === progressID && cancel ? {
            contains: (target: FocusTarget) => target === button,
        } : null,
    };
    const window = {
        setTimeout: (action: () => void, delay: number) => {
            assert.equal(delay, 300);
            timers.set(++timerID, action);
            return timerID;
        },
        clearTimeout: (id: number) => timers.delete(id),
        siyuan: {
            config: {editor: {checkBlockRef: true}},
            languages: {cancel: "Cancel", checkBlockRefProgress: "Checking..."},
        },
    };
    const dependencies = {
        "../dialog/confirmDialog": {confirmDialog: ({confirm}: {confirm: () => void}) => {
            confirmations++;
            confirm();
        }},
        "../dialog/message": {showMessage: (message: string) => messages.push(message)},
        "../dialog/progress": {progressLoading: (data: {code: number}, id: string,
                                                 action?: {label: string, callback: () => void}) => {
            assert.equal(id, progressID);
            if (data.code === 1) {
                assert.equal(action?.label, "Cancel");
                cancel = action.callback;
                button.focus();
            } else {
                cancel = undefined;
            }
        }},
        "../protyle/util/transactionQueue": {waitForPendingTransactions: () => pendingTransactions},
        "./fetch": {fetchSyncPost: (url: string, _options: unknown, _headers: unknown, process: boolean,
                                    signal: AbortSignal) => {
            assert.equal(url, "/api/block/checkBlockRef");
            assert.equal(process, false);
            return new Promise(resolve => requests.push({signal, respond: data => resolve({code: 0, data})}));
        }},
    };
    runInNewContext(source, {
        exports: api, window, document, HTMLElement: FocusTarget, AbortController,
        require: (id: keyof typeof dependencies) => dependencies[id],
    });
    return {
        api, window, document, editor, button, timers, messages, requests,
        get cancel() { return cancel; },
        get confirmations() { return confirmations; },
        showProgress: () => {
            assert.equal(timers.size, 1);
            timers.values().next().value();
            assert.equal(document.activeElement, button);
        },
    };
};

test("cancels deletion while waiting for pending editor transactions", async () => {
    let finishTransactions: () => void;
    const transactions = new Promise<void>(resolve => { finishTransactions = resolve; });
    const f = setup(transactions);
    const editor = {} as IProtyle;
    const checking = f.api.confirmBlockRef(blocks, editor);
    f.showProgress();
    f.cancel();
    assert.equal(await checking, false);
    assert.equal(f.cancel, undefined);
    assert.equal(f.document.activeElement, f.editor);
    finishTransactions();
    await transactions;
    assert.equal(f.requests.length, 0);
    assert.equal(f.confirmations, 0);
});

test("cancels all checks sharing the progress overlay and ignores a late result", async () => {
    const f = setup();
    const deleting = f.api.confirmBlockRef(blocks);
    const checking = f.api.checkBlockRef({scope: "notebook", notebook: "notebook"});
    f.showProgress();
    f.cancel();
    assert.deepEqual(await Promise.all([deleting, checking]), [false, undefined]);
    assert.ok(f.requests.every(request => request.signal.aborted));
    f.requests[0].respond(true);
    f.requests[1].respond(false);
    assert.equal(f.cancel, undefined);
    assert.equal(f.confirmations, 0);
    assert.deepEqual(f.messages, []);

    const retry = f.api.confirmBlockRef(blocks);
    assert.equal(f.requests[2].signal.aborted, false);
    f.requests[2].respond(true);
    assert.equal(await retry, true);
    assert.equal(f.confirmations, 1);
    assert.equal(f.timers.size, 0);
});
