import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/config/encryptedAssets.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

class Control {
    checked = false;
    indeterminate = false;
    disabled = false;
    textContent = "";
    dataset: Record<string, string> = {};
    classList = {add: () => {}, remove: () => {}};
    listeners = new Map<string, (event?: unknown) => unknown>();
    inputs: Control[] = [];
    html = "";
    set innerHTML(html: string) {
        this.html = html;
        this.inputs = Array.from(html.matchAll(/data-index="(\d+)"/g), match => {
            const input = new Control();
            input.dataset.index = match[1];
            return input;
        });
    }
    querySelectorAll() { return this.inputs; }
    closest() { return this; }
    addEventListener(name: string, handler: (event?: unknown) => unknown) { this.listeners.set(name, handler); }
    dispatch(name: string) { return this.listeners.get(name)?.(); }
}

const setup = (mobile = false) => {
    const controls = Object.fromEntries(["list", "all", "delete", "refresh", "preview", "cancel", "count"]
        .map(key => [key, new Control()]));
    const pending: Promise<unknown>[] = [];
    const requests: Array<{url: string, data: {notebook: string, paths?: string[]}}> = [];
    const callbacks: Array<() => void> = [];
    let current: {element: {isConnected: boolean, dataset: Record<string, string>}, destroy: () => void};
    let response = {code: 0, data: [
        {item: "assets/a.png", name: "<private name>.png", path: "assets/a.png?box=secret"},
        {item: "assets/b.png", name: "private-b.png", path: "assets/b.png?box=secret"},
    ]};
    let releaseScan: (() => void) | undefined;
    let delay = false;
    let maintenanceFailure = false;
    let previewClears = 0;
    const previews: string[][] = [];
    const siyuan = {config: {readonly: false}, notebooks: [{id: "secret", encrypted: true, closed: false}],
        languages: {loading: "Loading", emptyContent: "Empty", clearAll: "Confirm cleanup"}};
    const exports = {} as typeof import("./encryptedAssets");
    const dependencies = {
        Dialog: class {
            element = {isConnected: true, dataset: {} as Record<string, string>,
                querySelector: (selector: string) => controls[selector.match(/data-type="([^"]+)"/)[1]]};
            constructor(private options: {destroyCallback: () => void}) {
                current = {element: this.element, destroy: () => this.destroy()};
            }
            destroy() {
                this.element.dataset.dialogClosing = "true";
                this.element.isConnected = false;
                this.options.destroyCallback();
            }
        },
        AssetPreview: class {
            clear() { previewClears++; }
            show(...args: string[]) { previews.push(args); }
        },
        fetchSyncPost: async (url: string, data: typeof requests[number]["data"]) => {
            requests.push({url, data});
            if (delay) {
                await new Promise<void>(resolve => { releaseScan = resolve; });
            }
            return response;
        },
        confirmDialog: (_title: string, _content: string, confirm: () => void) => { callbacks.push(confirm); },
        showMessage: () => {},
        trackNotebookHistoryDialog: () => {},
        forgetNotebookHistoryDialog: () => {},
        escapeHtml: (text: string) => text.replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
        getNotebookName: () => "Private notebook",
        isMobile: () => mobile,
        runSettingsMaintenance: (action: () => Promise<unknown>) => {
            const task = maintenanceFailure ? Promise.resolve() : action();
            pending.push(task);
            return task;
        },
    };
    runInNewContext(compiled, {exports, require: () => dependencies,
        window: {siyuan}});
    return {
        controls, requests, callbacks, previews, siyuan,
        canClean: () => exports.canCleanEncryptedNotebookAssets("secret"),
        open: () => exports.openEncryptedAssetsCleanup("secret"),
        settle: async () => { await Promise.all(pending); await new Promise(resolve => setImmediate(resolve)); },
        close: () => current.destroy(),
        delay: () => { delay = true; },
        release: () => { delay = false; releaseScan?.(); },
        fail: () => { response = {code: -1, data: []}; },
        failMaintenance: (fail: boolean) => { maintenanceFailure = fail; },
        previewClears: () => previewClears,
    };
};

for (const mobile of [false, true]) {
    test(`${mobile ? "mobile" : "desktop"} cleanup previews and deletes only explicitly confirmed selections`, async () => {
        const state = setup(mobile);
        state.open();
        await state.settle();
        assert.equal(state.requests.length, 1);
        assert.equal(state.requests[0].data.notebook, "secret");
        assert.ok(state.controls.list.html.includes("&lt;private name&gt;"));
        assert.equal(state.controls.delete.disabled, true);
        state.controls.list.inputs[1].checked = true;
        state.controls.list.dispatch("change");
        assert.equal(state.controls.delete.disabled, false);
        state.controls.delete.dispatch("click");
        assert.equal(state.requests.length, 1);
        assert.equal(state.callbacks.length, 1);
        state.callbacks[0]();
        await state.settle();
        const deletion = state.requests.find(request => request.url.endsWith("removeUnusedEncryptedBoxAssets"));
        assert.deepEqual(JSON.parse(JSON.stringify(deletion.data)), {notebook: "secret", paths: ["assets/b.png"]});
        assert.equal(state.requests.filter(request => request.url.endsWith("getUnusedEncryptedBoxAssets")).length, 2);
        state.close();
        assert.ok(state.previewClears() >= 2);
    });
}

test("maintenance preparation failure releases cleanup controls and permits retry", async () => {
    const state = setup();
    state.open();
    await state.settle();
    state.controls.all.checked = true;
    state.controls.all.dispatch("change");
    state.controls.delete.dispatch("click");
    state.failMaintenance(true);
    state.callbacks[0]();
    await state.settle();
    assert.equal(state.requests.some(request => request.url.endsWith("removeUnusedEncryptedBoxAssets")), false);
    assert.equal(state.controls.refresh.disabled, false);
    state.failMaintenance(false);
    state.controls.all.checked = true;
    state.controls.all.dispatch("change");
    state.controls.delete.dispatch("click");
    state.callbacks[1]();
    await state.settle();
    assert.equal(state.requests.filter(request => request.url.endsWith("removeUnusedEncryptedBoxAssets")).length, 1);
    assert.equal(state.controls.refresh.disabled, false);
});

test("closing during a scan prevents publishing late decrypted filenames", async () => {
    const state = setup();
    state.delay();
    state.open();
    state.close();
    state.release();
    await state.settle();
    assert.equal(state.controls.list.html, "");
    assert.equal(state.requests.length, 1);
});

test("a confirmation cannot delete after the notebook dialog closes", async () => {
    const state = setup();
    state.open();
    await state.settle();
    state.controls.all.checked = true;
    state.controls.all.dispatch("change");
    state.controls.delete.dispatch("click");
    state.close();
    state.callbacks[0]();
    await state.settle();
    assert.equal(state.requests.length, 1);
});

test("cleanup is available only for an unlocked encrypted notebook in a writable workspace", () => {
    const state = setup();
    assert.equal(state.canClean(), true);
    state.siyuan.notebooks[0].closed = true;
    assert.equal(state.canClean(), false);
    state.open();
    assert.equal(state.requests.length, 0);
    state.siyuan.notebooks[0].closed = false;
    state.siyuan.notebooks[0].encrypted = false;
    assert.equal(state.canClean(), false);
    state.siyuan.notebooks[0].encrypted = true;
    state.siyuan.config.readonly = true;
    assert.equal(state.canClean(), false);
});
