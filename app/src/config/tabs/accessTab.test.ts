import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {ContractFormData} from "../../util/contractFormData";

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
        const dependencies = {
            isBrowser: () => browser,
            isMobile: () => mobile,
            getHostCapabilities: () => ({ownsKernel, importExport: ownsKernel}),
            fetchPost: (url: string, data: {enabled: boolean}) => requests.push({url, enabled: data.enabled}),
        };
        const exports = {} as {registerEncryptedNotebookGroup: (tab: unknown) => void};
        runInNewContext(compiled, {
            exports,
            require: () => dependencies,
            window: {siyuan: {config: {readonly: false, system: {os}}, languages: {}}},
        });
        exports.registerEncryptedNotebookGroup({group: () => ({
            slot: () => {},
            number: () => {},
            switch: (id: string, spec: {save: (value: unknown) => void}) => switches.push({id, save: spec.save}),
        })});
        assert.equal(switches.length, expected ? 1 : 0);
        if (expected) {
            assert.equal(switches[0].id, "system.encryptedNotebookFollowSystemLock");
            switches[0].save(true);
            switches[0].save(false);
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
