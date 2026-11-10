import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../../testSupport/loadModule";

const setup = () => {
    const win = {siyuan: {config: {readonly: false}, languages: {settingsPendingSaveError: "Save failed", uploading: "Uploading"}}};
    const saves = loadModule<typeof import("../../protyle/util/editorSave")>("src/protyle/util/editorSave.ts", {window: win});
    const calls: {operations: IOperation[], undo: IOperation[], options: {awaitResponse: boolean}}[] = [];
    let response = {code: 0, data: [{doOperations: [] as IOperation[]}]};
    const listeners = new Map<string, () => void>();
    const block = {dataset: {nodeId: "block"}, outerHTML: "<div>current draft</div>"};
    const blocks = [block];
    const protyle = {id: "secondary", disabled: false, element: {isConnected: true,
        addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
        removeEventListener: (name: string) => listeners.delete(name)},
        wysiwyg: {element: {querySelectorAll: () => blocks}}};
    let flushFails = false;
    let uploading = false;
    const editor = {protyle, isUploading: () => uploading, flushPendingTransactions: async () => {
        if (flushFails) throw new Error("Title failed");
    }} as unknown as import("../../protyle").Protyle;
    const module = loadModule<typeof import("./secondaryEditors")>("src/mobile/util/secondaryEditors.ts", {
        window: win, document: {addEventListener: () => {}},
        require: (name: string) => {
            if (name === "../../protyle/util/editorSave") return saves;
            if (name === "../../protyle/wysiwyg/transaction") return {transaction: async (_protyle: IProtyle,
                operations: IOperation[], undo: IOperation[], options: {awaitResponse: boolean}) => {
                calls.push({operations, undo, options});
                await saves.trackEditorSaveRequest("/api/transactions", {session: protyle.id,
                    transactions: [{doOperations: operations}]}, Promise.resolve(response));
            }};
            throw new Error(name);
        },
    });
    module.registerMobileSecondaryEditor(editor, () => {});
    const fail = (action = "update") => saves.trackEditorSaveRequest("/api/transactions", {session: protyle.id,
        transactions: [{doOperations: [{action, id: "block", data: "<div>old failed draft</div>"}]}]},
        Promise.resolve({code: -1}));
    return {module, editor, protyle, block, blocks, calls, listeners, win, fail,
        failRetry: (failed: boolean) => response = {code: failed ? -1 : 0, data: [{doOperations: [] as IOperation[]}]},
        setUploading: (value: boolean) => uploading = value,
        failFlush: (failed: boolean) => flushFails = failed};
};

test("secondary editor retries current block DOM and waits for acknowledgement before allowing close", async () => {
    const q = setup();
    await q.fail();
    q.failRetry(true);
    await assert.rejects(q.module.flushMobileSecondaryEditor(q.editor), /Save failed/);
    q.block.outerHTML = "<div>newest draft</div>";
    q.failRetry(false);
    await q.module.flushMobileSecondaryEditor(q.editor);
    assert.equal(q.calls.length, 2);
    assert.equal(q.calls[1].operations[0].data, q.block.outerHTML);
    assert.equal(q.calls[1].undo, undefined);
    assert.equal(q.calls[1].options.awaitResponse, true);
    q.module.unregisterMobileSecondaryEditor(q.editor);
    assert.equal(q.listeners.size, 0);
});

test("secondary editor refuses to replay structural, missing, disconnected and readonly updates", async () => {
    for (const invalid of ["structure", "missing", "disconnected", "disabled", "readonly"]) {
        const q = setup();
        await q.fail(invalid === "structure" ? "insert" : "update");
        if (invalid === "missing") q.blocks.length = 0;
        if (invalid === "disconnected") q.protyle.element.isConnected = false;
        if (invalid === "disabled") q.protyle.disabled = true;
        if (invalid === "readonly") q.win.siyuan.config.readonly = true;
        await assert.rejects(q.module.flushMobileSecondaryEditor(q.editor), /Save failed/, invalid);
        assert.equal(q.calls.length, 0, invalid);
        q.module.unregisterMobileSecondaryEditor(q.editor);
    }
});

test("a failed title flush does not poison the next secondary editor close attempt", async () => {
    const q = setup();
    q.failFlush(true);
    await assert.rejects(q.module.flushMobileSecondaryEditor(q.editor), /Title failed/);
    q.failFlush(false);
    await q.module.flushMobileSecondaryEditor(q.editor);
    assert.equal(q.calls.length, 0);
    q.module.unregisterMobileSecondaryEditor(q.editor);
});

test("editor dialog close waits for readiness, refuses active uploads and retries unconfirmed text", async () => {
    const q = setup();
    let ready = false;
    const guard = q.module.createMobileSecondaryEditorCloseGuard(() => q.editor, () => ready);
    assert.equal(await guard(), false);
    ready = true;
    q.setUploading(true);
    await assert.rejects(guard(), /Uploading/);
    q.setUploading(false);
    await q.fail();
    q.failRetry(true);
    await assert.rejects(guard(), /Save failed/);
    q.failRetry(false);
    assert.equal(await guard(), true);
    assert.equal(q.calls.length, 2);
    q.module.unregisterMobileSecondaryEditor(q.editor);
});
