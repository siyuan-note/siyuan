import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const cases = async (source: string) => {
    const check = require("node:assert/strict");
    let ownsKernel = true;
    let finish: () => void;
    let reject: (error: Error) => void;
    let requests = 0;
    const dependencies = {
        genUUID: () => "test-message", Constants: {SIYUAN_VERSION: "test"}, progressLoading: () => {},
        getHostCapabilities: () => ({remoteKernel: !ownsKernel, ownsKernel}),
        sanitizeKernelHTML: (value: string) => value,
        fetchPost: (url: string, data: {version: string}, callback: () => void) => {
            check.equal(url, "/api/system/downloadUpdate");
            check.deepEqual(data, {version: "99.0.0-alpha.1"});
            requests++;
            return new Promise<void>((resolve, fail) => {
                finish = () => {callback(); resolve();};
                reject = fail;
            });
        },
    };
    const api = new Function(...Object.keys(dependencies), source + "return {initMessage, showMessage};")(
        ...Object.values(dependencies));
    window.siyuan = {zIndex: 0, languages: {}} as unknown as typeof window.siyuan;
    const message = document.createElement("div");
    message.id = "message";
    document.body.append(message);
    api.initMessage();
    const notification = 'New release <a href="https://example.com/release">Release</a> ' +
        '<button type="button" data-type="download-update" data-version="99.0.0-alpha.1">Download this version</button>';
    const notify = () => api.showMessage(notification, -1, "info", "update-notify");
    const button = () => message.querySelector<HTMLButtonElement>('[data-type="download-update"]');
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    notify();
    button().click();
    check.equal(button().disabled, true);
    button().click();
    check.equal(requests, 1, "repeated clicks cannot start another request while pending");
    reject(new Error("Download failed"));
    await tick();
    check.equal(button().disabled, false, "network failure permits retrying");
    check.match(message.textContent, /Download failed/);
    button().click();
    finish();
    await tick();
    check.equal(requests, 2);
    const accepted = message.querySelector('[data-id="update-notify"]');
    check.ok(!accepted || accepted.classList.contains("b3-snackbar--hide"),
        "accepted download dismisses the update notification");
    ownsKernel = false;
    notify();
    check.equal(button(), null, "remote frontends do not offer downloading the server's installer");
    check.ok(message.querySelector("a"), "remote frontends retain the release link");
    ownsKernel = true;
    api.showMessage(notification, -1, "info", "unrelated");
    button().click();
    check.equal(requests, 2, "only the update notification can invoke the download action");
    api.showMessage("Select all", -1, "info", "select-all-tip");
    const selectAllTip = message.querySelector('[data-id="select-all-tip"]');
    check.equal(api.showMessage("Loading...", -1, "info", "select-all-tip"), "select-all-tip",
        "replacing an existing notification returns its id so callers can hide it");
    check.equal(message.querySelectorAll('[data-id="select-all-tip"]').length, 1,
        "replacing an existing notification reuses its element");
    check.equal(message.querySelector('[data-id="select-all-tip"]'), selectAllTip);
    check.equal(selectAllTip.textContent, "Loading...");
    return "update-message-ok";
};

test("update notifications support one-off download, retries and remote frontend restrictions", {timeout: 30000}, async () => {
    const source = transpileModule(readFileSync("src/dialog/message.ts", "utf8")
        .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-update-message-"));
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        "const __name = value => value; (" + cases.toString() + ")(" + JSON.stringify(source) + ")")}));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});`);
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /update-message-ok/);
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
        rmSync(directory, {recursive: true, force: true});
    }
});
