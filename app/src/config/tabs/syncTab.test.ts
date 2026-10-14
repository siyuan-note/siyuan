import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const preprocess = require("ifdef-loader/preprocessor").parse;

const createSnapshotButton = ({mobile = false, browser = false, settingsWindow = true} = {}) => {
    const nativeSettings = !mobile && !browser && settingsWindow;
    const source = preprocess(readFileSync("src/config/tabs/syncTab.ts", "utf8"), {MOBILE: mobile, BROWSER: browser});
    const code = transpileModule(source +
        "\nexports.mount = mountSyncCloudBackup;", {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    let click: () => Promise<void>;
    let complete: () => void;
    let fail: (error: Error) => void;
    let loading: Promise<void>;
    let loads = 0;
    let opened = 0;
    let errors = 0;
    let attached = true;
    let dialogOpen = true;
    let ownerActive = true;
    let notebookReads = 0;
    let runtimeImports = 0;
    let notebooksLoading = Promise.resolve();
    let completeNotebooks: () => void;
    let failNotebooks: (error: Error) => void;
    let openedNotebooks: string[];
    const app = {};
    const window = {closed: false, siyuan: {ws: {app}, notebooks: ["old"], languages: {_kernel: {258: "Operation failed"}}}};
    const button = {isConnected: true, disabled: false, addEventListener: (_type: string, callback: typeof click) => {
        click = callback;
    }};
    const root = {isConnected: true, contains: () => attached, querySelector: () => button,
        closest: () => mobile ? null : {classList: {contains: () => dialogOpen}}};
    const exports = {} as {mount: (root: any) => void};
    runInNewContext(code, {exports, window, console: {error() {}}, require: (name: string) => {
        if (name === "../../constants") return {Constants: {DIALOG_SETTING: "settings"}};
        if (name === "../../protyle/util/lute") return {ensureLute: (options?: {reloadOnFailure: boolean}) => {
            assert.equal(options?.reloadOnFailure, nativeSettings ? false : undefined);
            loads++;
            return loading;
        }};
        if (name === "../setting/windowContext") return {isSettingsWindow: () => settingsWindow,
            getSettingsWindowHost: () => ({isActive: () => ownerActive})};
        if (name === "../setting/windowRuntime") {
            runtimeImports++;
            return {refreshSettingsWindowNotebooks: () => { notebookReads++; return notebooksLoading; }};
        }
        if (name === "../../history/history") return {openHistory: (historyApp: unknown, type: string, openOnly: boolean) => {
            assert.equal(historyApp, app);
            assert.equal(type, "repo");
            assert.equal(openOnly, true);
            openedNotebooks = [...window.siyuan.notebooks];
            opened++;
        }};
        if (name === "../../dialog/message") return {showMessage: () => errors++};
        return {};
    }});
    const retry = () => loading = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    const waitForNotebooks = () => notebooksLoading = new Promise<void>((resolve, reject) => {
        completeNotebooks = resolve;
        failNotebooks = reject;
    });
    retry();
    exports.mount(root);
    return {button, root, window, retry, click: () => click(), complete: () => complete(),
        fail: () => fail(new Error("Lute unavailable")), loads: () => loads, opened: () => opened,
        errors: () => errors, unmount: () => { attached = false; }, close: () => { dialogOpen = false; },
        dispose: () => { ownerActive = false; }, notebookReads: () => notebookReads, runtimeImports: () => runtimeImports,
        waitForNotebooks, completeNotebooks: () => { window.siyuan.notebooks = ["latest"]; completeNotebooks(); },
        failNotebooks: () => failNotebooks(new Error("Notebook refresh failed")), openedNotebooks: () => openedNotebooks};
};

test("snapshot history waits for Lute and coalesces repeated clicks", async () => {
    const snapshot = createSnapshotButton();
    const first = snapshot.click();
    const second = snapshot.click();
    assert.equal(snapshot.loads(), 1);
    assert.equal(snapshot.opened(), 0);
    assert.equal(snapshot.button.disabled, true);
    snapshot.complete();
    await Promise.all([first, second]);
    assert.equal(snapshot.opened(), 1);
    assert.equal(snapshot.button.disabled, false);
});

test("a failed snapshot dependency leaves no history dialog and can be retried", async () => {
    const snapshot = createSnapshotButton();
    const pending = snapshot.click();
    snapshot.fail();
    await pending;
    assert.equal(snapshot.opened(), 0);
    assert.equal(snapshot.errors(), 1);
    assert.equal(snapshot.button.disabled, false);
    snapshot.retry();
    const retried = snapshot.click();
    snapshot.complete();
    await retried;
    assert.equal(snapshot.opened(), 1);
    assert.equal(snapshot.loads(), 2);
});

test("snapshot completion ignores detached, replaced, closing, and closed settings", async () => {
    for (const action of ["detach", "replace", "close", "closed", "dispose"]) {
        for (const fail of [false, true]) {
            const snapshot = createSnapshotButton();
            const pending = snapshot.click();
            if (action === "detach") snapshot.root.isConnected = false;
            if (action === "replace") snapshot.unmount();
            if (action === "close") snapshot.close();
            if (action === "closed") snapshot.window.closed = true;
            if (action === "dispose") snapshot.dispose();
            if (fail) snapshot.fail();
            else snapshot.complete();
            await pending;
            assert.equal(snapshot.opened(), 0, action);
            assert.equal(snapshot.errors(), 0, action);
        }
    }
});

test("ordinary and mobile snapshots retain default Lute recovery without importing the native runtime", async () => {
    for (const options of [{mobile: true}, {browser: true}, {settingsWindow: false}]) {
        const snapshot = createSnapshotButton(options);
        const pending = snapshot.click();
        snapshot.complete();
        await pending;
        assert.equal(snapshot.opened(), 1);
        assert.equal(snapshot.runtimeImports(), 0);
        assert.equal(snapshot.notebookReads(), 0);
    }
});

test("native snapshot history waits for the coalesced notebook refresh as well as Lute", async () => {
    const snapshot = createSnapshotButton();
    snapshot.waitForNotebooks();
    const pending = snapshot.click();
    const repeated = snapshot.click();
    snapshot.complete();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(snapshot.opened(), 0);
    assert.equal(snapshot.loads(), 1);
    assert.equal(snapshot.notebookReads(), 1);
    snapshot.completeNotebooks();
    await Promise.all([pending, repeated]);
    assert.equal(snapshot.opened(), 1);
    assert.deepEqual(snapshot.openedNotebooks(), ["latest"]);
});

test("snapshot notebook failure and a disposed owner cannot open a partial history", async () => {
    for (const disposed of [false, true]) {
        const snapshot = createSnapshotButton();
        snapshot.waitForNotebooks();
        const pending = snapshot.click();
        snapshot.complete();
        await Promise.resolve();
        if (disposed) {
            snapshot.dispose();
            snapshot.completeNotebooks();
        } else {
            snapshot.failNotebooks();
        }
        await pending;
        assert.equal(snapshot.opened(), 0);
        assert.equal(snapshot.errors(), disposed ? 0 : 1);
        assert.equal(snapshot.button.disabled, false);
    }
});
