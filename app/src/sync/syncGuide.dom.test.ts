import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

const browserCases = (sources: string[]) => {
    const check: typeof assert = require("node:assert/strict");
    for (const [mobile, code] of sources.entries()) {
        for (const initializeKey of [false, true]) {
            document.body.innerHTML = "";
            const requests: {url: string, data: unknown, reply: (response: unknown) => void}[] = [];
            const confirmations: (() => void)[] = [];
            const config = {readonly: false, sync: {provider: 0, enabled: false, cloudName: "main"},
                repo: {key: initializeKey ? "" : "fixture-key"}};
            class Dialog {
                element = document.createElement("div");
                constructor(options: {content: string}) {
                    this.element.innerHTML = '<div class="b3-dialog__header"></div><div class="b3-dialog__body">' +
                        options.content + "</div>";
                    document.body.append(this.element);
                }
                destroy() { this.element.remove(); }
            }
            const dependencies: Record<string, unknown> = {
                "../dialog": {Dialog},
                "../util/needSubscribe": {needSubscribe: () => false, isPaidUser: () => true},
                "./checkoutProgress": {openSyncCheckoutProgress: () => false},
                "../util/functions": {isMobile: () => !!mobile},
                "../constants": {Constants: {DIALOG_SYNCCHOOSEDIR: "choose-dir", DIALOG_SETPASSWORD: "set-password"}},
                "../util/hostCapabilities": {sanitizeKernelHTML: (value: string) => value},
                "../dialog/processSystem": {processSync() {}},
                "../dialog/confirmDialog": {confirmDialog: (_title: string, _text: string, confirm: () => void) =>
                    confirmations.push(confirm)},
                "../util/fetch": {fetchPost: (url: string, data: unknown, reply: (response: unknown) => void) =>
                    requests.push({url, data, reply})},
                "../config/util/configApi": {config: {set: (name: string, value: unknown, applied: () => void) => {
                    requests.push({url: "/api/setting/patch", data: {[name]: value}, reply: applied});
                    return Promise.resolve();
                }}},
            };
            const guide = {} as {syncGuide: () => void,
                renderSyncCloudList: (element: Element, reload: boolean) => void};
            new Function("exports", "require", "window", "document", code)(guide,
                (name: string) => dependencies[name] || {},
                {siyuan: {config, languages: new Proxy({}, {get: (_target, name) => String(name)})}}, document);
            guide.syncGuide();
            if (initializeKey) {
                document.querySelectorAll<HTMLInputElement>(".b3-text-field").forEach(input => { input.value = "test"; });
                const checkbox = document.querySelector<HTMLInputElement>("#confirmPassword");
                checkbox.checked = true;
                checkbox.dispatchEvent(new Event("change"));
                document.querySelector<HTMLButtonElement>("#initKeyByPW").click();
                check.equal(confirmations.length, 1);
                confirmations.shift()();
                const initialize = requests.shift();
                check.equal(initialize.url, "/api/repo/initRepoKeyFromPassphrase");
                initialize.reply({code: 0, data: {key: "fixture-key"}});
            }
            const list = document.querySelector(".b3-dialog__content").lastElementChild;
            const enable = document.querySelector<HTMLButtonElement>(".b3-dialog__action button");
            check.ok(list.querySelector(".b3-loading"));
            check.equal(enable.disabled, true);
            check.equal(requests.length, 1, `initial directory request (mobile=${!!mobile}, initializeKey=${initializeKey})`);
            const listing = requests.shift();
            check.equal(listing.url, "/api/sync/listCloudSyncDir");
            listing.reply({code: 0, data: {
                syncDirs: [{cloudName: "main", hSize: "1 MB", updated: "2026-11-01"}], checkedSyncDir: "main",
            }});
            check.equal(list.querySelector<HTMLInputElement>('input[name="cloudName"]').checked, true);
            check.match(list.textContent, /main/);
            check.equal(list.querySelector(".b3-loading"), null);
            check.equal(enable.disabled, false);
            check.equal(config.sync.enabled, false);

            guide.renderSyncCloudList(list, false);
            check.equal(requests.length, 0, "the loaded directory list is reused");
            guide.renderSyncCloudList(list, true);
            check.equal(requests.length, 1, "settings can force a fresh directory listing");
            const refresh = requests.shift();
            check.equal(refresh.url, "/api/sync/listCloudSyncDir");
            refresh.reply({code: 0, data: {
                syncDirs: [{cloudName: "main", hSize: "2 MB", updated: "2026-11-02"}], checkedSyncDir: "main",
            }});
            check.match(list.textContent, /2 MB/);

            enable.click();
            check.equal(requests.length, 1);
            const enableSync = requests.shift();
            check.equal(enableSync.url, "/api/setting/patch");
            check.deepEqual(enableSync.data, {"sync.enabled": true});
            enableSync.reply({code: 0});
            check.equal(config.sync.enabled, true);
            check.equal(requests.length, 0, "sync waits for user confirmation");
            check.equal(confirmations.length, 1);
            confirmations.shift()();
            check.equal(requests[0].url, "/api/sync/performSync");
        }
    }
    return "Sync setup directory cases passed";
};

test("sync setup loads directories and enables sync after selection on desktop and mobile", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = readFileSync(path.join(__dirname, "syncGuide.ts"), "utf8");
    const sources = [false, true].map(mobile => transpileModule(
        parse(source, {MOBILE: mobile, BROWSER: true}, false, true), {
            compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
        }).outputText);
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-sync-guide-test-"));
    const script = path.join(temporary, "run.cjs");
    const browserSource = `(() => { const __name = value => value;
try { return {result: (${browserCases.toString()})(${JSON.stringify(sources)})}; }
catch (error) { return {error: error.stack}; } })()`;
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        const result = await win.webContents.executeJavaScript(${JSON.stringify(browserSource)});
        if (result.error) throw new Error(result.error);
        console.log(result.result);
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Sync setup directory cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-sync-guide-test-"));
        rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
});
