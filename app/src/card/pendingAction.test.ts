import * as assert from "node:assert/strict";
import {test} from "node:test";
import {loadModule} from "../testSupport/loadModule";

test("mobile card actions await saving and rendering, reject duplicates, and retain drafts after failure", async () => {
    let finishSave: () => void;
    let finishRender: () => void;
    let failSave = false;
    let pending = false;
    let actions = 0;
    const editor = {protyle: {element: {isConnected: true, classList: {contains: () => true}}}};
    const dialog = {element: {isConnected: true}, runPending: async (task: () => Promise<boolean>, options: {close: boolean, disableButtons: boolean}) => {
        assert.equal(options.close, false);
        assert.equal(options.disableButtons, false);
        if (pending) return false;
        pending = true;
        try {return await task();} finally {pending = false;}
    }};
    const {runCardAction} = loadModule<{runCardAction: (dialog: unknown, editor: unknown, action: () => Promise<void>) => Promise<unknown>}>("src/card/pendingAction.ts", {
        require: (name: string) => name === "../util/functions" ? {isMobile: () => true} : {
            createMobileSecondaryEditorCloseGuard: () => async () => {
                await new Promise<void>(resolve => finishSave = resolve);
                if (failSave) throw Error("Save failed");
                return true;
            },
        },
    });
    const action = async () => {actions++; await new Promise<void>(resolve => finishRender = resolve);};
    const first = runCardAction(dialog, editor, action);
    assert.equal(actions, 0);
    assert.equal(await runCardAction(dialog, editor, action), false);
    finishSave();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(actions, 1);
    assert.equal(pending, true);
    finishRender();
    await first;
    assert.equal(pending, false);
    failSave = true;
    const failed = runCardAction(dialog, editor, action);
    finishSave();
    await assert.rejects(failed, /Save failed/);
    assert.equal(actions, 1);
    failSave = false;
    const removed = runCardAction(dialog, editor, action);
    dialog.element.isConnected = false;
    finishSave();
    await removed;
    assert.equal(actions, 1);
});
