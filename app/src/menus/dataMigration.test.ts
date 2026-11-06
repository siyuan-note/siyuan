import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

class Control {
    value = "box";
    handlers: Record<string, (event?: unknown) => void> = {};
    addEventListener(name: string, handler: (event?: unknown) => void) { this.handlers[name] = handler; }
}

const setup = () => {
    const requests: string[] = [];
    const dialogs: MockDialog[] = [];
    let finish: (response: {code: number}) => void;
    class MockDialog {
        data: {confirmed?: boolean};
        pending = false;
        closed = false;
        controls = new Map<string, Control>();
        buttons = [new Control(), new Control()];
        element = {
            querySelector: (selector: string) => {
                if (!this.controls.has(selector)) this.controls.set(selector, new Control());
                return this.controls.get(selector);
            },
            querySelectorAll: () => this.buttons,
            addEventListener() {},
        };
        constructor(private options: {destroyCallback?: () => void}) { dialogs.push(this); }
        destroy() {
            if (this.pending || this.closed) return;
            this.closed = true;
            this.options.destroyCallback?.();
        }
        async runPending(task: () => Promise<boolean>, options: {close?: boolean} = {}) {
            if (this.pending || this.closed) return false;
            this.pending = true;
            let success: boolean;
            try { success = await task(); } finally { this.pending = false; }
            if (success && options.close !== false) this.destroy();
            return success;
        }
    }
    const code = transpileModule(readFileSync("src/menus/dataMigration.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const api: {openDataMigration: () => void} = {} as never;
    runInNewContext(code, {
        exports: api,
        FormData: class {append() {}},
        window: {siyuan: {config: {repo: {key: ""}}, notebooks: [{id: "box", name: "Notebook", closed: false}],
            languages: {dataMigration: "Import", targetNotebook: "Target", confirm: "Confirm", cancel: "Cancel"}}},
        require: () => ({
            MobileDialog: MockDialog,
            Constants: {HELP_PATH: {}},
            isMobile: () => true,
            getHostCapabilities: () => ({documentImportExport: true, importExport: false, localFileSystem: false}),
            escapeHtml: (value: string) => value,
            fetchSyncPost: (url: string) => {
                requests.push(url);
                if (url.endsWith("importSYAuto")) return Promise.resolve({code: 0, data: {type: "document", token: "token"}});
                return new Promise(resolve => { finish = resolve; });
            },
            fetchPost: (url: string) => requests.push(url),
        }),
    });
    api.openDataMigration();
    const settle = () => new Promise<void>(resolve => setImmediate(resolve));
    return {dialogs, requests, settle, finish: (code: number) => finish({code}), start: async () => {
        dialogs[0].element.querySelector('[data-type="siyuan"]').handlers.change({target: {files: [{}], value: "file"}});
        await settle();
    }};
};

test("mobile SY target selection keeps failed continuation retryable and cancels the token once", async () => {
    const state = setup();
    await state.start();
    const target = state.dialogs[1];
    target.buttons[1].handlers.click();
    target.buttons[1].handlers.click();
    target.destroy();
    assert.equal(target.closed, false);
    assert.equal(state.requests.filter(url => url.endsWith("continueImportSY")).length, 1);
    state.finish(-1);
    await state.settle();
    assert.equal(target.closed, false);
    assert.equal(state.dialogs[0].closed, false);
    target.buttons[0].handlers.click();
    target.destroy();
    assert.equal(state.requests.filter(url => url.endsWith("cancelImportSY")).length, 1);
});

test("mobile SY continuation closes its target and parent only after success", async () => {
    const state = setup();
    await state.start();
    const target = state.dialogs[1];
    target.buttons[1].handlers.click();
    assert.equal(state.dialogs[0].closed, false);
    state.finish(0);
    await state.settle();
    assert.equal(target.closed, true);
    assert.equal(state.dialogs[0].closed, true);
    assert.equal(state.requests.some(url => url.endsWith("cancelImportSY")), false);
});
