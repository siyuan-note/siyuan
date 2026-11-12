import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");

const browserCases = async (sources: string[], styles: string[]) => {
    const check: typeof assert = require("node:assert/strict");
    for (const [mobile, code] of sources.entries()) {
        const style = document.createElement("style");
        style.textContent = styles[mobile];
        document.head.replaceChildren(style);
        for (const initializeKey of [false, true]) {
            document.body.innerHTML = "";
            const requests: {url: string, data: unknown, reply: (response: unknown) => void}[] = [];
            const confirmations: (() => void)[] = [];
			const messages: string[] = [];
            const config = {readonly: false, sync: {provider: 0, enabled: false, cloudName: "main"},
                repo: {key: initializeKey ? "" : "fixture-key"}};
            class Dialog {
                element = document.createElement("div");
                pending = false;
                constructor(options: {content: string}) {
                    this.element.innerHTML = '<div class="b3-dialog__header"></div><div class="b3-dialog__body">' +
                        options.content + "</div>";
                    document.body.append(this.element);
                }
                destroy() { this.element.remove(); }
                invalidate() { this.destroy(); }
                focusWhenReady(target: () => HTMLElement) { target()?.focus(); }
                async runPending(task: () => Promise<boolean>, options: {close?: boolean} = {}) {
                    if (this.pending) return false;
                    this.pending = true;
                    const result = await task().catch(() => false);
                    this.pending = false;
                    if (result && options.close !== false) this.destroy();
                    return result;
                }
            }
            const dependencies: Record<string, unknown> = {
                "../dialog/mobileDialog": {MobileDialog: Dialog},
                "../dialog/message": {showMessage: (message: string) => messages.push(message)},
                "../util/escape": {escapeHtml: (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")},
                "../util/needSubscribe": {needSubscribe: () => false, isPaidUser: () => true},
                "./checkoutProgress": {openSyncCheckoutProgress: () => false},
                "../util/functions": {isMobile: () => !!mobile},
                "../constants": {Constants: {DIALOG_SYNCCHOOSEDIR: "choose-dir", DIALOG_SETPASSWORD: "set-password"}},
                "../util/hostCapabilities": {sanitizeKernelHTML: (value: string) => value},
                "../dialog/processSystem": {processSync() {}},
                "../dialog/mobileConfirmDialog": {mobileConfirmDialog: (_title: string, _text: string, confirm: () => void) =>
                    confirmations.push(confirm)},
                "../util/fetch": {fetchPost: (url: string, data: unknown, reply: (response: unknown) => void) =>
                    requests.push({url, data, reply}), fetchSyncPost: (url: string, data: unknown) =>
                    new Promise(resolve => requests.push({url, data, reply: resolve}))},
                "../config/util/configApi": {config: {set: (name: string, value: unknown, applied: () => void) =>
                    new Promise<void>((resolve, reject) => {
                        requests.push({url: "/api/setting/patch", data: {[name]: value}, reply: (response: {code: number}) => {
                            if (response.code !== 0) { reject(new Error("Enable failed")); return; }
                            applied();
                            resolve();
                        }});
                    })}},
            };
            const guide = {} as {syncGuide: () => void,
                renderSyncCloudList: (element: Element, reload: boolean) => void};
            new Function("exports", "require", "window", "document", code)(guide,
                (name: string) => dependencies[name] || {},
                {siyuan: {config, languages: new Proxy({}, {get: (_target, name) => name === "_kernel" ?
                    {464: "Review the latest preview and choose again"} : name === "syncSourcePreview" ?
                    "Local ${local}; cloud ${cloud}; ${device}; upload ${upload}; overwrite ${overwrite}; remove ${remove}" : String(name)})}}, document);
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
                await new Promise(resolve => setTimeout(resolve, 0));
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
            await new Promise(resolve => setTimeout(resolve, 0));
            check.equal(list.querySelector<HTMLInputElement>('input[name="cloudName"]').checked, true);
            check.match(list.textContent, /main/);
            check.equal(list.querySelector(".b3-loading"), null);
            check.equal(enable.disabled, false);
            check.equal(config.sync.enabled, false);
            const listHeight = list.getBoundingClientRect().height;
            if (mobile) {
                check.ok(listHeight < innerHeight * 0.4 - 40, "one directory does not reserve an empty fixed-height region");
            } else {
                check.ok(Math.abs(listHeight - innerHeight * 0.4) < 1, "desktop keeps its directory viewport height");
            }

            guide.renderSyncCloudList(list, false);
            check.equal(requests.length, 0, "the loaded directory list is reused");
            guide.renderSyncCloudList(list, true);
            check.equal(requests.length, 1, "settings can force a fresh directory listing");
            const refresh = requests.shift();
            check.equal(refresh.url, "/api/sync/listCloudSyncDir");
            refresh.reply({code: 0, data: {
                syncDirs: [{cloudName: "main", hSize: "2 MB", updated: "2026-11-02"}], checkedSyncDir: "main",
            }});
            await new Promise(resolve => setTimeout(resolve, 0));
            check.match(list.textContent, /2 MB/);

            enable.click();
            enable.click();
            check.equal(requests.length, 1);
            check.equal(enable.isConnected, true);
            requests.shift().reply({code: -1});
            await new Promise(resolve => setTimeout(resolve, 0));
            check.equal(config.sync.enabled, false);
            check.equal(enable.isConnected, true, "failed enabling preserves the selected directory");
            check.equal(confirmations.length, 0);
            enable.click();
            const enableSync = requests.shift();
            check.equal(enableSync.url, "/api/setting/patch");
            check.deepEqual(enableSync.data, {"sync.enabled": true});
            enableSync.reply({code: 0});
            await new Promise(resolve => setTimeout(resolve, 0));
            check.equal(config.sync.enabled, true);
            check.equal(requests.length, 0, "sync waits for user confirmation");
            check.equal(confirmations.length, 1);
            confirmations.shift()();
            check.equal(requests[0].url, "/api/sync/getSyncSourceState");
            requests.shift().reply({data: {pending: initializeKey, source: "new-source", localID: "local", cloudID: "cloud",
                localFiles: 12, cloudFiles: 10, cloudCreated: 1, cloudDevice: "<img src=x>", uploadFiles: 3, overwriteFiles: 1, removeFiles: 2}});
            if (initializeKey) {
                check.equal(requests.length, 0, "changed sources require an explicit direction");
                check.equal(document.querySelector('input[name="upload"]:checked'), null);
                check.match(document.body.textContent, /Local 12; cloud 10; <img src=x>; upload 3; overwrite 1; remove 2/);
                check.equal(document.querySelector("img"), null, "device names are escaped");
                const buttons = document.querySelectorAll<HTMLButtonElement>(".b3-dialog__action button");
                buttons[1].click();
                check.deepEqual(messages, ["plsChoose"]);
                check.equal(requests.length, 0);
                document.querySelector<HTMLInputElement>(`input[name="upload"][value="${!mobile}"]`).checked = true;
                buttons[1].click();
                buttons[1].click();
                check.equal(requests.length, 1);
                check.equal(buttons[1].isConnected, true);
                check.equal(requests[0].url, "/api/sync/performSync");
                check.deepEqual(requests[0].data, {upload: !mobile, source: "new-source", localID: "local", cloudID: "cloud"});
                requests.shift().reply({code: -1});
                await new Promise(resolve => setTimeout(resolve, 0));
                check.equal(buttons[1].isConnected, true, "failed submission preserves the direction form");
                check.equal(document.querySelector<HTMLInputElement>('input[name="upload"]:checked').value, String(!mobile));
                buttons[1].click();
                check.equal(requests.length, 1);
                requests.shift().reply({code: 2, msg: "", data: null});
                await new Promise(resolve => setTimeout(resolve, 0));
                check.equal(requests.length, 1, "stale previews trigger one refresh, never another sync");
                check.equal(requests[0].url, "/api/sync/getSyncSourceState");
                check.equal(document.querySelector('input[name="upload"]:checked'), null);
                check.match(document.body.textContent, /Review the latest preview and choose again/);
                requests.shift().reply({code: -1, msg: "preview unavailable"});
                await new Promise(resolve => setTimeout(resolve, 0));
                check.equal(buttons[1].textContent, "refresh");
                check.doesNotMatch(document.body.textContent, /Local 12/);
                buttons[1].click();
                buttons[1].click();
                check.equal(requests.length, 1, "failed refresh retries are serialized");
                check.equal(requests[0].url, "/api/sync/getSyncSourceState");
                requests.shift().reply({code: 0, data: {pending: true, source: "fresh-source", localID: "fresh-local",
                    cloudID: "fresh-cloud", localFiles: 13, cloudFiles: 11, cloudCreated: 2, cloudDevice: "<img src=x>",
                    uploadFiles: 4, overwriteFiles: 2, removeFiles: 3}});
                await new Promise(resolve => setTimeout(resolve, 0));
                check.equal(buttons[1].textContent, "confirm");
                check.match(document.body.textContent, /Local 13; cloud 11; <img src=x>; upload 4; overwrite 2; remove 3/);
                check.equal(document.querySelector("img"), null);
                check.equal(requests.length, 0, "refresh requires explicit confirmation");
                check.equal(document.querySelector('input[name="upload"]:checked'), null);
                document.querySelector<HTMLInputElement>(`input[name="upload"][value="${!mobile}"]`).checked = true;
                buttons[1].click();
                check.deepEqual(requests[0].data, {upload: !mobile, source: "fresh-source", localID: "fresh-local", cloudID: "fresh-cloud"});
                requests.shift().reply({code: 0});
                await new Promise(resolve => setTimeout(resolve, 0));
                check.equal(buttons[1].isConnected, false);
                guide.syncGuide();
                requests.shift().reply({code: 0, data: {pending: true, source: "another-source", localID: "local", cloudID: "cloud"}});
                document.querySelector<HTMLInputElement>('input[name="upload"][value="true"]').checked = true;
                document.querySelectorAll<HTMLButtonElement>(".b3-dialog__action button")[1].click();
                requests.shift().reply({code: 2, msg: "", data: null});
                await new Promise(resolve => setTimeout(resolve, 0));
                requests.shift().reply({code: 0, data: {pending: false, source: ""}});
                await new Promise(resolve => setTimeout(resolve, 0));
                check.equal(document.querySelector('input[name="upload"]'), null, "another client's completed choice dismisses the obsolete form");
                check.equal(requests.length, 0, "resolved sources do not implicitly start automatic sync");
            } else {
                check.equal(requests[0].url, "/api/sync/performSync");
                check.deepEqual(requests[0].data, {});
                requests.shift();
                guide.syncGuide();
                check.equal(requests[0].url, "/api/sync/getSyncSourceState");
                requests.shift().reply({data: {pending: false, source: "empty-source", localID: "local", cloudID: ""}});
                check.equal(requests[0].url, "/api/sync/performSync");
                check.deepEqual(requests[0].data, {upload: true, source: "empty-source", localID: "local", cloudID: ""});
                requests.shift().reply({code: 2, msg: "", data: null});
                check.equal(requests[0].url, "/api/sync/getSyncSourceState");
                requests.shift().reply({code: 0, data: {pending: false, source: "empty-source", localID: "fresh-empty-local", cloudID: ""}});
                await new Promise(resolve => setTimeout(resolve, 0));
                check.equal(requests.length, 0, "empty-source invalidation also requires confirmation instead of retrying uploads");
                check.equal(document.querySelector<HTMLInputElement>('input[name="upload"][value="false"]').disabled, true);
                document.querySelector<HTMLInputElement>('input[name="upload"][value="true"]').checked = true;
                document.querySelectorAll<HTMLButtonElement>(".b3-dialog__action button")[1].click();
                check.deepEqual(requests[0].data, {upload: true, source: "empty-source", localID: "fresh-empty-local", cloudID: ""});
                requests.shift().reply({code: 0});
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
    }
    return "Sync setup directory cases passed";
};

test("sync setup and stale preview recovery require confirmed choices on desktop and mobile", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = readFileSync(path.join(__dirname, "syncGuide.ts"), "utf8");
    const sources = [false, true].map(mobile => transpileModule(
        parse(source, {MOBILE: mobile, BROWSER: true}, false, true), {
            compilerOptions: {target: ScriptTarget.ES2021, module: ModuleKind.CommonJS},
        }).outputText);
    const sass = require("sass");
    const styles = ["base", "mobile"].map(name => sass.compile(path.resolve("src/assets/scss/" + name + ".scss"), {
        logger: sass.Logger.silent,
    }).css);
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-sync-guide-test-"));
    const script = path.join(temporary, "run.cjs");
    const browserSource = `(async () => { const __name = value => value;
try { return {result: await (${browserCases.toString()})(${JSON.stringify(sources)}, ${JSON.stringify(styles)})}; }
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
