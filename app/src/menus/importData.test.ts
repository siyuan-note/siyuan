import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/menus/importData.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

class Control {
    value = "";
    disabled = false;
    required = false;
    hidden = false;
    classList = {toggle: (_name: string, hidden: boolean) => this.hidden = hidden};
    listeners = new Map<string, () => Promise<void> | void>();
    addEventListener(event: string, handler: () => Promise<void> | void) {
        this.listeners.set(event, handler);
    }
    async dispatch(event: string) {
        await this.listeners.get(event)?.();
    }
}

const setup = (encrypted = ["box"], conflicts = ["box"], commitWait = Promise.resolve()) => {
    const requests: Array<{url: string, data: {id?: string, mode?: string, password?: string}}> = [];
    const dialogs: MockDialog[] = [];
    let selectedMode = "skip";
    let commitCode = 0;
    let prepareCode = 0;
    const messages: unknown[] = [];
    class MockDialog {
        controls = new Map<string, Control>();
        modes = [new Control(), new Control()];
        destroyed = false;
        element = {
            querySelector: (selector: string) => {
                if (selector.endsWith(":checked")) {
                    const current = new Control();
                    current.value = selectedMode;
                    return current;
                }
                return this.controls.get(selector);
            },
            querySelectorAll: () => this.modes,
        };
        constructor(public options: {content: string, width: string, destroyCallback: () => void, beforeClose?: () => boolean}) {
            for (const name of ["password", "password-label", "import", "cancel", "confirm"]) {
                this.controls.set(`[data-type="${name}"]`, new Control());
            }
            dialogs.push(this);
        }
        destroy() {
            if (!this.destroyed && this.options.beforeClose?.() !== false) {
                this.destroyed = true;
                this.options.destroyCallback();
            }
        }
        control(name: string) {
            return this.controls.get(`[data-type="${name}"]`);
        }
    }
    const exports = {} as {
        importDataFile: (file: File, onComplete?: () => void) => Promise<void>;
        needsDataImportPassword: (plan: {encrypted: string[], conflicts: string[]}, mode: string) => boolean;
    };
    const dependencies = {
        Dialog: MockDialog,
        ContractFormData: class {},
        escapeHtml: (value: string) => value.replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
        isMobile: () => true,
        showMessage: (...args: unknown[]) => messages.push(args),
        fetchSyncPost: async (url: string, data: {id?: string, mode?: string, password?: string}) => {
            requests.push({url, data});
            if (url.endsWith("prepareDataImport")) {
                return {code: prepareCode, data: {id: "plan-id", encrypted, conflicts}};
            }
            if (url.endsWith("commitDataImport")) {
                await commitWait;
                return {code: commitCode, data: {skipped: data.mode === "skip" ? conflicts : []}};
            }
            return {code: 0};
        },
    };
    runInNewContext(compiled, {exports, require: () => dependencies, window: {siyuan: {languages: {
        import: "Import", imported: "Imported", dataImportConflicts: "Conflicts", dataImportSkip: "Skip",
        dataImportOverwrite: "Overwrite", dataImportSkipped: "Skipped notebooks", masterPassword: "Password",
        importDataTip: "Overwrite by path", cancel: "Cancel", confirm: "Confirm",
    }}}});
    return {exports, requests, dialogs, messages,
        selectMode: (mode: string) => selectedMode = mode,
        failCommit: () => commitCode = -1,
        failPrepare: () => prepareCode = -1};
};

test("Data.zip defaults to skip and shows skipped IDs before reloading", async () => {
    const state = setup(["<box>"], ["<box>"]);
    let completed = 0;
    await state.exports.importDataFile({} as File, () => completed++);
    assert.equal(state.dialogs.length, 1);
    const dialog = state.dialogs[0];
    assert.equal(dialog.options.width, "92vw");
    assert.match(dialog.options.content, /value="skip" checked/);
    assert.match(dialog.options.content, /&lt;box&gt;/);
    assert.equal(dialog.control("password-label").hidden, true);
    await dialog.control("import").dispatch("click");
    const commit = state.requests.find((item) => item.url.endsWith("commitDataImport"));
    assert.equal(commit.data.mode, "skip");
    assert.equal(commit.data.password, "");
    assert.equal(state.dialogs.length, 2);
    assert.match(state.dialogs[1].options.content, /Skipped notebooks.*&lt;box&gt;/);
    assert.equal(completed, 0);
    assert.equal(state.requests.some((item) => item.url.endsWith("reloadUI")), false);
    await state.dialogs[1].control("confirm").dispatch("click");
    assert.equal(completed, 1);
    assert.equal(state.requests.some((item) => item.url.endsWith("reloadUI")), true);
    assert.equal(state.requests.some((item) => item.url.endsWith("cancelDataImport")), false);
});

test("Data.zip overwrite requires a password and failed authentication remains retryable", async () => {
    const state = setup();
    await state.exports.importDataFile({} as File);
    const dialog = state.dialogs[0];
    state.selectMode("overwrite");
    await dialog.modes[1].dispatch("change");
    assert.equal(dialog.control("import").disabled, true);
    assert.equal(dialog.control("password").required, true);
    dialog.control("password").value = " secret ";
    await dialog.control("password").dispatch("input");
    assert.equal(dialog.control("import").disabled, false);
    state.failCommit();
    await dialog.control("import").dispatch("click");
    const commit = state.requests.find((item) => item.url.endsWith("commitDataImport"));
    assert.equal(commit.data.mode, "overwrite");
    assert.equal(commit.data.password, "secret");
    assert.equal(dialog.destroyed, false);
    assert.equal(dialog.control("password").value, "");
    assert.equal(state.dialogs.length, 1);
    assert.equal(state.requests.some((item) => item.url.endsWith("reloadUI")), false);
});

test("Data.zip cancellation only cancels the prepared upload", async () => {
    const state = setup();
    await state.exports.importDataFile({} as File);
    await state.dialogs[0].control("cancel").dispatch("click");
    assert.equal(state.requests.filter((item) => item.url.endsWith("cancelDataImport")).length, 1);
    assert.equal(state.requests.some((item) => item.url.endsWith("commitDataImport")), false);
});

test("Data.zip blocks cancel and shared dialog close paths while commit is pending", async () => {
    let finish: () => void;
    const wait = new Promise<void>((resolve) => finish = resolve);
    const state = setup([], [], wait);
    await state.exports.importDataFile({} as File);
    const dialog = state.dialogs[0];
    const committing = dialog.control("import").dispatch("click");
    assert.equal(dialog.control("cancel").disabled, true);
    await dialog.control("cancel").dispatch("click");
    dialog.destroy();
    assert.equal(dialog.destroyed, false);
    assert.equal(state.requests.some((item) => item.url.endsWith("cancelDataImport")), false);
    finish();
    await committing;
    assert.equal(dialog.destroyed, true);
    assert.equal(state.dialogs.length, 2);
});

test("Data.zip still authenticates non-conflicting encrypted notebooks when conflicts are skipped", () => {
    const state = setup();
    assert.equal(state.exports.needsDataImportPassword({encrypted: ["old", "new"], conflicts: ["old"]}, "skip"), true);
    assert.equal(state.exports.needsDataImportPassword({encrypted: ["old"], conflicts: ["old"]}, "skip"), false);
    assert.equal(state.exports.needsDataImportPassword({encrypted: ["old"], conflicts: ["old"]}, "overwrite"), true);
});

test("failed Data.zip analysis opens no import dialog", async () => {
    const state = setup();
    state.failPrepare();
    await state.exports.importDataFile({} as File);
    assert.equal(state.dialogs.length, 0);
    assert.equal(state.requests.length, 1);
});
