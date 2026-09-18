import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const setup = () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/tabs/syncRuntime.ts"), "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const config = {sync: {provider: 0}, readonly: false};
    const createSelect = () => ({value: "0", disabled: false, setAttribute: () => {}});
    const elements = [createSelect()];
    const root = {querySelectorAll: () => elements, querySelector: (): null => null};
    const requests: {resolve: (response: unknown) => void, reject: (error: Error) => void}[] = [];
    let refreshes = 0;
    const runtime = {} as {
        patchSyncConfig: (id: string, value: number) => Promise<void>;
        mountSyncProvider: (root: unknown) => void;
        mountSyncTabExtras: (root: unknown) => void;
    };
    runInNewContext(code, {
        exports: runtime,
        document: root,
        window: {siyuan: {config}},
        console: {warn: () => {}},
        require: (name: string) => {
            if (name === "../../util/fetch") {
                return {fetchSyncPost: (url: string, data: {provider: number}) => {
                    assert.equal(url, "/api/sync/setSyncProvider");
                    assert.equal(data.provider, 2);
                    return new Promise((resolve, reject) => requests.push({resolve, reject}));
                }};
            }
            if (name === "./syncUi") {
                return {refreshSyncTabPanels: () => { refreshes++; }};
            }
            if (name === "./accountUi") {
                return {updateAccountPanelVisibility: () => {}};
            }
            return {};
        },
    });
    runtime.mountSyncTabExtras(root);
    return {runtime, config, elements, root, requests, createSelect, refreshes: () => refreshes};
};

for (const outcome of ["success", "rejected", "network error"]) {
    test(`provider selection follows confirmed configuration after ${outcome}`, async () => {
        const ui = setup();
        ui.elements[0].value = "2";
        const pending = ui.runtime.patchSyncConfig("sync.provider", 2);
        assert.equal(ui.elements[0].disabled, true);
        assert.equal(ui.config.sync.provider, 0);
        await ui.runtime.patchSyncConfig("sync.provider", 3);
        assert.equal(ui.requests.length, 1);
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
    });
}

test("provider request completion preserves readonly controls", async () => {
    const ui = setup();
    const pending = ui.runtime.patchSyncConfig("sync.provider", 2);
    ui.config.readonly = true;
    ui.requests[0].resolve({code: -1});
    await pending;
    assert.equal(ui.elements[0].value, "0");
    assert.equal(ui.elements[0].disabled, true);
});
