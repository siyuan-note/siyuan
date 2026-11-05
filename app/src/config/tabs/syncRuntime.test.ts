import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {escapeHtml} from "../../util/escape";

const setup = () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/tabs/syncRuntime.ts"), "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const config = {sync: {provider: 0, assetDownloadMode: 1}, readonly: false};
    const createSelect = () => ({value: "0", disabled: false, setAttribute: () => {}});
    const elements = [createSelect()];
    const root = {querySelectorAll: () => elements, querySelector: (): null => null};
    const requests: {resolve: (response: unknown) => void, reject: (error: Error) => void}[] = [];
    const settings: {mode: number, resolve: () => void, reject: (error: unknown) => void}[] = [];
    const timers = new Map<number, () => void>();
    const hidden: string[] = [];
    const confirmations: {confirm: () => void, cancel: () => void}[] = [];
    const progress: number[] = [];
    const messages: string[] = [];
    let refreshes = 0;
    const runtime = {} as {
        patchSyncConfig: (id: string, value: number) => Promise<void>;
        mountSyncProvider: (root: unknown) => void;
        mountSyncAssetDownloadMode: (root: unknown) => void;
        mountSyncTabExtras: (root: unknown) => void;
    };
    runInNewContext(code, {
        exports: runtime,
        document: root,
        window: {
            siyuan: {config, languages: {_kernel: {398: "Checking"}, syncProviderChangeFailed: "Failed",
                syncAssetDownloadModeFailed: "Mode update failed", syncAssetDownloadModeUpdating: "Downloading"}},
            setTimeout: (callback: () => void) => { timers.set(1, callback); return 1; },
            clearTimeout: (id: number) => timers.delete(id),
        },
        Error,
        console: {warn: () => {}},
        require: (name: string) => {
            if (name === "../../util/escape") return {escapeHtml};
            if (name === "../util/configApi") {
                return {config: {set: (path: string, mode: number) => {
                    assert.equal(path, "sync.assetDownloadMode");
                    return new Promise<void>((resolve, reject) => settings.push({mode, resolve, reject})).then(() => {
                        config.sync.assetDownloadMode = mode;
                    });
                }}};
            }
            if (name === "../../util/fetch") {
                return {fetchSyncPost: (url: string, data: {provider: number, completeAssets: boolean}) => {
                    assert.equal(url, "/api/sync/setSyncProvider");
                    assert.equal(data.provider, 2);
                    assert.equal(data.completeAssets, true);
                    return new Promise((resolve, reject) => requests.push({resolve, reject}));
                }};
            }
            if (name === "../../dialog/mobileConfirmDialog") {
                return {mobileConfirmDialog: (_title: string, _text: string, confirm: () => void, cancel: () => void) => {
                    confirmations.push({confirm, cancel});
                }};
            }
            if (name === "../../dialog/progress") {
                return {progressLoading: (data: {code: number}) => progress.push(data.code)};
            }
            if (name === "../../dialog/message") {
                return {showMessage: (message: string) => String(messages.push(message)), hideMessage: (id: string) => hidden.push(id)};
            }
            if (name === "./syncUi") {
                return {refreshSyncTabPanels: () => { refreshes++; }};
            }
            if (name === "./accountUi") {
                return {updateAccountPanelVisibility: () => {}};
            }
            if (name === "../../sync/syncGuide") {
                return {refreshSyncCloudDirBlock: () => {}};
            }
            return {};
        },
    });
    runtime.mountSyncTabExtras(root);
    return {runtime, config, elements, root, requests, settings, timers, hidden, confirmations, progress, messages,
        createSelect, refreshes: () => refreshes};
};

for (const outcome of ["success", "rejected", "network error"]) {
    test(`provider selection follows confirmed configuration after ${outcome}`, async () => {
        const ui = setup();
        ui.elements[0].value = "2";
        const pending = ui.runtime.patchSyncConfig("sync.provider", 2);
        assert.equal(ui.elements[0].disabled, true);
        assert.equal(ui.config.sync.provider, 0);
        await ui.runtime.patchSyncConfig("sync.provider", 3);
        assert.equal(ui.requests.length, 0);
        assert.equal(ui.confirmations.length, 1);
        assert.deepEqual(ui.progress, []);
        ui.confirmations[0].confirm();
        await Promise.resolve();
        assert.equal(ui.requests.length, 1);
        assert.deepEqual(ui.progress, [1]);
        assert.equal(ui.elements[0].value, "2");
        ui.elements.splice(0, 1, ui.createSelect());
        ui.runtime.mountSyncProvider(ui.root);
        assert.equal(ui.elements[0].disabled, true);
        assert.equal(ui.elements[0].value, "2");
        if (outcome === "network error") {
            ui.requests[0].reject(new Error("offline"));
        } else {
            ui.requests[0].resolve({code: outcome === "success" ? 0 : -1});
        }
        await pending;
        const provider = outcome === "success" ? 2 : 0;
        assert.equal(ui.config.sync.provider, provider);
        assert.equal(ui.elements[0].value, String(provider));
        assert.equal(ui.elements[0].disabled, false);
        assert.equal(ui.refreshes(), outcome === "success" ? 2 : 1);
        assert.deepEqual(ui.progress, [1, 2]);
        assert.equal(ui.messages.length, outcome === "network error" ? 1 : 0);
    });
}

test("provider request completion preserves readonly controls", async () => {
    const ui = setup();
    const pending = ui.runtime.patchSyncConfig("sync.provider", 2);
    ui.confirmations[0].confirm();
    await Promise.resolve();
    ui.config.readonly = true;
    ui.requests[0].resolve({code: -1});
    await pending;
    assert.equal(ui.elements[0].value, "0");
    assert.equal(ui.elements[0].disabled, true);
});

test("canceling provider confirmation restores the selection without checking or downloading", async () => {
    const ui = setup();
    const pending = ui.runtime.patchSyncConfig("sync.provider", 2);
    ui.confirmations[0].cancel();
    await pending;
    assert.equal(ui.requests.length, 0);
    assert.deepEqual(ui.progress, []);
    assert.equal(ui.elements[0].value, "0");
    assert.equal(ui.elements[0].disabled, false);
    assert.equal(ui.config.sync.provider, 0);
    assert.equal(ui.refreshes(), 1);
});

test("selecting the current provider does not ask for confirmation", async () => {
    const ui = setup();
    await ui.runtime.patchSyncConfig("sync.provider", 0);
    assert.equal(ui.confirmations.length, 0);
    assert.equal(ui.requests.length, 0);
});

test("asset mode errors show kernel guidance as text, restore controls, and permit retry", async () => {
    const ui = setup();
    ui.elements[0].value = "0";
    const pending = ui.runtime.patchSyncConfig("sync.assetDownloadMode", 0);
    assert.equal(ui.elements[0].disabled, true);
    await ui.runtime.patchSyncConfig("sync.assetDownloadMode", 1);
    assert.equal(ui.settings.length, 1);
    ui.timers.get(1)();
    ui.elements.splice(0, 1, ui.createSelect());
    ui.runtime.mountSyncAssetDownloadMode(ui.root);
    assert.equal(ui.elements[0].disabled, true);
    const message = 'Use the original account <img src="x" onerror="alert(1)"> & retry';
    ui.settings[0].reject(new Error(message));
    await pending;
    assert.deepEqual(ui.messages, ["Downloading", escapeHtml(message)]);
    assert.deepEqual(ui.hidden, ["1"]);
    assert.equal(ui.timers.size, 0);
    assert.equal(ui.config.sync.assetDownloadMode, 1);
    assert.equal(ui.elements[0].value, "1");
    assert.equal(ui.elements[0].disabled, false);
    const retried = ui.runtime.patchSyncConfig("sync.assetDownloadMode", 0);
    assert.equal(ui.settings.length, 2);
    ui.settings[1].resolve();
    await retried;
    assert.equal(ui.config.sync.assetDownloadMode, 0);
    assert.equal(ui.elements[0].value, "0");
    assert.equal(ui.elements[0].disabled, false);
    assert.equal(ui.timers.size, 0);
    assert.equal(ui.messages.length, 2);
});

test("asset mode failures without an Error message keep the fallback and readonly state", async () => {
    for (const error of [new Error(""), null, "offline"]) {
        const ui = setup();
        const pending = ui.runtime.patchSyncConfig("sync.assetDownloadMode", 0);
        ui.config.readonly = true;
        ui.settings[0].reject(error);
        await pending;
        assert.deepEqual(ui.messages, ["Mode update failed"]);
        assert.equal(ui.elements[0].value, "1");
        assert.equal(ui.elements[0].disabled, true);
        assert.equal(ui.timers.size, 0);
    }
});
