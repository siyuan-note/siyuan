import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {ContractFormData} from "../../util/contractFormData";

test("crypto backup import preserves password bytes and rejects only an empty input", async () => {
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
    assert.equal(requests.length, 0);
    for (const password of [" password ", "   ", "\tpassword\n", "\u00a0password\u3000"]) {
        confirm(password, dialog);
        await Promise.resolve();
        assert.equal(requests[requests.length - 1].get("password"), password);
        assert.ok(requests[requests.length - 1].get("file") instanceof Blob);
    }
    assert.equal(destroyed, 4);
});
