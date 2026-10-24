import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const setup = () => {
    const panels: Panel[] = [];
    const pending: Array<{resolve: () => void, reject: (error: Error) => void}> = [];
    const registered = new Set<Panel>();
    const makeProtyle = (id: string, notebookId = "box") => ({
        block: {id, rootID: id, showAll: false}, notebookId,
        element: {classList: {contains: () => false}},
        contentElement: {querySelector: () => ({
            setAttribute: () => {}, removeAttribute: () => {},
        })},
    });
    const window = {siyuan: {config: {editor: {backlinkShowBottom: true}},
        mobile: {editor: {protyle: makeProtyle("first")}}}};
    class Panel {
        backlink: {blockId: string, rootId: string, notebookId: string, editors: object[]};
        destroyed = false;
        private unregister: () => void;
        constructor(private protyle: ReturnType<typeof makeProtyle>, private register: (panel: Panel) => () => void) {
            panels.push(this);
        }
        update() {
            if (!this.backlink) {
                this.backlink = {blockId: this.protyle.block.id, rootId: this.protyle.block.rootID,
                    notebookId: this.protyle.notebookId, editors: [{}]};
                this.unregister = this.register(this);
            }
        }
        destroy() {
            this.destroyed = true;
            this.unregister?.();
        }
    }
    const api: typeof import("./bottomBacklink") = {} as never;
    const code = transpileModule(readFileSync(join(__dirname, "bottomBacklink.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const modules = {
        "../../layout/dock/BottomBacklinkPanel": {BottomBacklinkPanel: Panel,
            getBottomBacklinkBlockId: (protyle: ReturnType<typeof makeProtyle>) => protyle.block.id},
        "./backlinkPanels": {registerMobileBacklinkPanel: (panel: Panel) => {
            registered.add(panel);
            return () => registered.delete(panel);
        }},
        "./secondaryEditors": {flushMobileSecondaryEditor: () => new Promise<void>((resolve, reject) => {
            pending.push({resolve, reject});
        })},
    };
    runInNewContext(code, {window, exports: api, require: (name: keyof typeof modules) => modules[name]});
    return {api, window, panels, pending, registered, makeProtyle};
};

test("mobile bottom backlinks save inputs before switching documents and retain notebook scope", async () => {
    const state = setup();
    await state.api.updateMobileBottomBacklinkPanel();
    const closing = state.api.closeMobileBottomBacklinkPanel();
    assert.equal(state.panels[0].destroyed, false);
    assert.equal(state.registered.size, 1);
    state.pending[0].resolve();
    await closing;
    assert.equal(state.panels[0].destroyed, true);
    assert.equal(state.registered.size, 0);
    state.window.siyuan.mobile.editor.protyle = state.makeProtyle("second", "encrypted-box");
    await state.api.updateMobileBottomBacklinkPanel();
    assert.equal(state.panels[1].backlink.blockId, "second");
    assert.equal(state.panels[1].backlink.notebookId, "encrypted-box");
});

test("mobile bottom backlinks retain unsaved input on failure and allow retry", async () => {
    const state = setup();
    await state.api.updateMobileBottomBacklinkPanel();
    const closing = state.api.closeMobileBottomBacklinkPanel();
    state.pending[0].reject(new Error("save failed"));
    await assert.rejects(closing, /save failed/);
    assert.equal(state.panels[0].destroyed, false);
    assert.equal(state.registered.size, 1);
    const retry = state.api.closeMobileBottomBacklinkPanel();
    state.pending[1].resolve();
    await retry;
    assert.equal(state.panels[0].destroyed, true);
});

test("disabling and resetting mobile bottom backlinks flushes editors before removing them", async () => {
    for (const reset of [false, true]) {
        const state = setup();
        await state.api.updateMobileBottomBacklinkPanel();
        state.window.siyuan.config.editor.backlinkShowBottom = reset;
        const updating = state.api.updateMobileBottomBacklinkPanel(undefined, reset);
        assert.equal(state.panels[0].destroyed, false);
        state.pending[0].resolve();
        await updating;
        assert.equal(state.panels[0].destroyed, true);
        assert.equal(state.registered.size, reset ? 1 : 0);
        if (!reset) {
            state.window.siyuan.config.editor.backlinkShowBottom = true;
            await state.api.updateMobileBottomBacklinkPanel();
            assert.equal(state.registered.size, 1);
        }
    }
});

test("zooming and switching notebooks replaces the mobile panel after saving", async () => {
    for (const key of ["block", "notebook"]) {
        const state = setup();
        await state.api.updateMobileBottomBacklinkPanel();
        const protyle = state.window.siyuan.mobile.editor.protyle;
        if (key === "block") protyle.block.id = "zoomed";
        else protyle.notebookId = "encrypted-box";
        const updating = state.api.updateMobileBottomBacklinkPanel();
        state.pending[0].resolve();
        await updating;
        assert.equal(state.panels[0].destroyed, true);
        assert.equal(state.panels[1].backlink.blockId, protyle.block.id);
        assert.equal(state.panels[1].backlink.notebookId, protyle.notebookId);
    }
});

test("navigation cancels a pending reset without recreating an old document's panel", async () => {
    const state = setup();
    await state.api.updateMobileBottomBacklinkPanel();
    const resetting = state.api.updateMobileBottomBacklinkPanel(undefined, true);
    const closing = state.api.closeMobileBottomBacklinkPanel();
    assert.equal(state.pending.length, 1);
    state.pending[0].resolve();
    await Promise.all([resetting, closing]);
    assert.equal(state.panels.length, 1);
    assert.equal(state.registered.size, 0);
});

test("destroying the owner releases its panel and stale close completion preserves the next panel", async () => {
    const state = setup();
    await state.api.updateMobileBottomBacklinkPanel();
    const closing = state.api.closeMobileBottomBacklinkPanel();
    state.api.destroyMobileBottomBacklinkPanel(state.window.siyuan.mobile.editor.protyle as unknown as IProtyle);
    state.window.siyuan.mobile.editor.protyle = state.makeProtyle("next");
    await state.api.updateMobileBottomBacklinkPanel();
    state.pending[0].resolve();
    await closing;
    assert.equal(state.registered.size, 1);
    assert.equal(state.panels[1].destroyed, false);
});
