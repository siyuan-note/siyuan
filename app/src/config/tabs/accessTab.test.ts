import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {ContractFormData} from "../../util/contractFormData";

test("wallpaper settings require password or OIDC authentication on desktop, web and mobile", () => {
    const compiled = transpileModule(readFileSync("src/config/tabs/accessTab.ts", "utf8") +
        "\nexport {registerAccessAuthGroup};", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    for (const browser of [false, true]) {
        for (const mobile of [false, true]) {
            for (const readonly of [false, true]) {
                for (const password of ["", "password"]) {
                    for (const oidc of [false, true]) {
                        const slots: string[] = [];
                        const appearance = {lockScreenWallpaper: true};
                        const exports = {} as {registerAccessAuthGroup: (tab: unknown) => void};
                        runInNewContext(compiled, {exports, require: () => ({
                            isBrowser: () => browser, isInMobileApp: () => mobile,
                            getHostCapabilities: () => ({oidcAuthentication: true}),
                        }), window: {siyuan: {config: {readonly, accessAuthCode: password,
                            oidc: {enabled: oidc}, api: {token: "token"}, appearance}, languages: {about14: "${token}"}}}});
                        exports.registerAccessAuthGroup({group: () => ({
                            button: () => {}, switch: () => {}, text: () => {},
                            slot: (spec: {key: string}) => slots.push(spec.key),
                        })});
                        assert.equal(slots.includes("lockScreenWallpaper"), !readonly && Boolean(password || oidc),
                            JSON.stringify({browser, mobile, readonly, password: Boolean(password), oidc}));
                        assert.equal(appearance.lockScreenWallpaper, true, "hiding the setting preserves the wallpaper");
                    }
                }
            }
        }
    }
});

test("OIDC activation refreshes the wallpaper setting without waiting for its configuration notification", () => {
    const compiled = transpileModule(readFileSync("src/config/tabs/accessTab.ts", "utf8") +
        "\nexport {registerAccessAuthGroup, applyActivatedOIDC};", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const config = {readonly: false, accessAuthCode: "", oidc: {enabled: false}, api: {token: "token"}};
    const slots: string[] = [];
    const tab = {group: () => ({button: () => {}, switch: () => {}, text: () => {},
        slot: (spec: {key: string}) => slots.push(spec.key)})};
    const exports = {} as {registerAccessAuthGroup: (tab: unknown) => void; applyActivatedOIDC: (config: unknown) => void};
    runInNewContext(compiled, {exports, window: {siyuan: {config, languages: {about14: "${token}"}}}, require: () => ({
        isBrowser: () => false, isInMobileApp: () => false,
        getHostCapabilities: () => ({oidcAuthentication: true}),
        remountOpenSettingTab: (id: string) => {
            assert.equal(id, "access");
            exports.registerAccessAuthGroup(tab);
        },
    })});
    exports.registerAccessAuthGroup(tab);
    assert.equal(slots.includes("lockScreenWallpaper"), false);
    exports.applyActivatedOIDC({enabled: true});
    assert.equal(config.oidc.enabled, true);
    assert.equal(slots.includes("lockScreenWallpaper"), true);
});

test("encrypted notebook system lock is offered only for supported local desktop kernels", () => {
    const compiled = transpileModule(readFileSync("src/config/tabs/accessTab.ts", "utf8") +
        "\nexport {registerEncryptedNotebookGroup};", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    for (const [os, browser, mobile, ownsKernel, expected] of [
        ["windows", false, false, true, true],
        ["darwin", false, false, true, true],
        ["linux", false, false, true, false],
        ["windows", true, false, true, false],
        ["windows", false, false, false, false],
        ["darwin", false, true, true, false],
    ] as const) {
        const switches: Array<{id: string, save: (value: unknown) => void}> = [];
        const requests: Array<{url: string, enabled: boolean}> = [];
        const system = {os, encryptedNotebookFollowSystemLock: false};
        let confirmSave: () => void;
        const dependencies = {
            isBrowser: () => browser,
            isMobile: () => mobile,
            getHostCapabilities: () => ({ownsKernel, importExport: ownsKernel}),
            fetchPost: (url: string, data: {enabled: boolean}, callback: () => void) => {
                requests.push({url, enabled: data.enabled});
                confirmSave = callback;
            },
        };
        const exports = {} as {registerEncryptedNotebookGroup: (tab: unknown) => void};
        runInNewContext(compiled, {
            exports,
            require: () => dependencies,
            window: {siyuan: {config: {readonly: false, system}, languages: {}}},
        });
        exports.registerEncryptedNotebookGroup({group: () => ({
            slot: () => {},
            button: () => {},
            number: () => {},
            switch: (id: string, spec: {save: (value: unknown) => void}) => switches.push({id, save: spec.save}),
        })});
        assert.equal(switches.length, expected ? 1 : 0);
        if (expected) {
            assert.equal(switches[0].id, "system.encryptedNotebookFollowSystemLock");
            switches[0].save(true);
            assert.equal(system.encryptedNotebookFollowSystemLock, false);
            confirmSave();
            assert.equal(system.encryptedNotebookFollowSystemLock, true);
            switches[0].save(false);
            assert.equal(system.encryptedNotebookFollowSystemLock, true);
            confirmSave();
            assert.equal(system.encryptedNotebookFollowSystemLock, false);
            switches[0].save("true");
            assert.deepEqual(requests, [
                {url: "/api/notebook/setEncryptedNotebookFollowSystemLock", enabled: true},
                {url: "/api/notebook/setEncryptedNotebookFollowSystemLock", enabled: false},
            ]);
        }
    }
});

test("crypto backup import trims passwords and rejects whitespace-only input", async () => {
    const compiled = transpileModule(readFileSync("src/config/tabs/accessTab.ts", "utf8") +
        "\nexport {mountEncryptedNotebook};", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const listeners = new Map<string, () => void>();
    const root = {
        querySelector: (selector: string) => ({
            querySelector: (child: string) => root.querySelector(child),
            addEventListener: (_event: string, callback: () => void) => listeners.set(selector, callback),
        }),
    };
    const file = new Blob(["backup"], {type: "application/json"});
    const input = {files: [file], onchange: (): void => undefined, click() { this.onchange(); }};
    let confirm: (value: string, dialog: {destroy: () => void}) => void;
    const requests: FormData[] = [];
    let destroyed = 0;
    const dependencies = {
        ContractFormData,
        getHostCapabilities: () => ({importExport: true}),
        fetchPost: (): void => undefined,
        fetchSyncPost: async (url: string, data: FormData) => {
            assert.equal(url, "/api/notebook/importNotebookCryptoBackup");
            requests.push(data);
            return {code: 0};
        },
        openInputDialog: (options: {onConfirm: typeof confirm}) => { confirm = options.onConfirm; },
        showMessage: (): void => undefined,
    };
    const exports = {} as {mountEncryptedNotebook: (element: typeof root) => void};
    runInNewContext(compiled, {
        exports,
        require: () => dependencies,
        document: {createElement: () => input},
        window: {siyuan: {languages: {}}},
    });
    exports.mountEncryptedNotebook(root);
    listeners.get("#importCryptoBackupBtn")();
    const dialog = {destroy: () => { destroyed++; }};
    confirm("", dialog);
    confirm("   ", dialog);
    confirm("\t\u00a0\u3000\n", dialog);
    assert.equal(requests.length, 0);
    for (const password of [" password ", "\tpassword\n", "\u00a0password\u3000"]) {
        confirm(password, dialog);
        await Promise.resolve();
        assert.equal(requests[requests.length - 1].get("password"), password.trim());
        assert.ok(requests[requests.length - 1].get("file") instanceof Blob);
    }
    assert.equal(destroyed, 3);
});

test("recovery-required key configuration can be disabled and cannot import another archive", () => {
    const compiled = transpileModule(readFileSync("src/config/tabs/accessTab.ts", "utf8") +
        "\nexport {refreshEncryptedNotebookStatus};", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const controls = new Map<string, {checked: boolean, disabled: boolean, classList: {toggle: () => void, remove: () => void}}>();
    const root = {
        querySelector: (selector: string) => {
            if (!controls.has(selector)) {
                controls.set(selector, {checked: false, disabled: false, classList: {toggle: () => {}, remove: () => {}}});
            }
            return controls.get(selector);
        },
    };
    let state = "RecoveryRequired";
    const dependencies = {
        getHostCapabilities: () => ({importExport: true}),
        fetchPost: (url: string, data: object, callback: (response: unknown) => void) => {
            assert.equal(url, "/api/notebook/getEncryptedNotebookStatus");
            assert.equal(Object.keys(data).length, 0);
            callback({data: {state, migrationPending: false}});
        },
    };
    const config = {notebookCrypto: {enabled: false}};
    const exports = {} as {refreshEncryptedNotebookStatus: (element: typeof root) => void};
    runInNewContext(compiled, {exports, require: () => dependencies, window: {siyuan: {config}}});
    exports.refreshEncryptedNotebookStatus(root);
    assert.equal(root.querySelector("#encryptedNotebookSwitch").checked, true);
    assert.equal(root.querySelector("#restoreEncryptedNotebooks").disabled, true);
    assert.equal(config.notebookCrypto.enabled, false);
    state = "Disabled";
    exports.refreshEncryptedNotebookStatus(root);
    assert.equal(root.querySelector("#encryptedNotebookSwitch").checked, false);
    assert.equal(root.querySelector("#restoreEncryptedNotebooks").disabled, false);
});
