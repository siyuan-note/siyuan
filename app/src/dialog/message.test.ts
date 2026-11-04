import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";

const cases = async (source: string, styles: string[], themes: string[]) => {
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
    const recovery = "1![image](assets/" + "long-image-path-".repeat(80) + ".png)2\n  Keep indentation\n\nLast line";
    const pre = document.createElement("pre");
    pre.textContent = recovery;
    api.showMessage("Content changed" + pre.outerHTML, 0, "error", "recovery");
    await tick();
    const notificationHTML = message.querySelector('[data-id="recovery"]').outerHTML;
    for (const css of styles) {
        for (const width of [320, 1024]) {
            const frame = document.createElement("iframe");
            frame.style.width = width + "px";
            frame.style.height = "600px";
            document.body.append(frame);
            const doc = frame.contentDocument;
            const style = doc.createElement("style");
            style.textContent = css;
            doc.head.append(style);
            const theme = doc.createElement("style");
            doc.head.append(theme);
            doc.body.innerHTML = '<div class="b3-snackbars b3-snackbars--show">' + notificationHTML + "</div>";
            for (const themeCSS of themes) {
                theme.textContent = themeCSS;
                for (const fontSize of [14, 24]) {
                    doc.body.style.setProperty("--b3-font-size", fontSize + "px");
                    const content = doc.querySelector<HTMLElement>(".b3-snackbar__content");
                    const restored = content.querySelector("pre");
                    const computed = frame.contentWindow.getComputedStyle(restored);
                    check.equal(computed.whiteSpace, "pre-wrap");
                    check.equal(computed.overflowWrap, "anywhere");
                    check.equal(restored.textContent, recovery, "wrapping cannot truncate recovery text or collapse line breaks");
                    const range = doc.createRange();
                    range.selectNodeContents(restored);
                    const selection = frame.contentWindow.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                    check.equal(selection.toString(), recovery, "the complete recovery Markdown remains selectable");
                    check.ok(content.scrollWidth <= content.clientWidth + 1,
                        `recovery content must fit its notification at ${width}px and ${fontSize}px font size`);
                    check.ok(content.getBoundingClientRect().left >= 0);
                    check.ok(content.getBoundingClientRect().right <= width);
                }
            }
            frame.remove();
        }
    }
    return "update-message-ok";
};

test("notifications support update retries and preserve wrapped recovery text on desktop and mobile", {timeout: 30000}, async () => {
    const source = transpileModule(readFileSync("src/dialog/message.ts", "utf8")
        .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const sass = require("sass") as typeof import("sass");
    const styles = ["base", "mobile"].map(name => sass.compile(`src/assets/scss/${name}.scss`, {
        logger: sass.Logger.silent,
    }).css);
    const themes = ["daylight", "midnight"].map(name => readFileSync(`appearance/themes/${name}/theme.css`, "utf8"));
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-update-message-"));
    const script = path.join(directory, "main.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(directory, "profile"))});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        "const __name = value => value; (" + cases.toString() + ")(" + JSON.stringify(source) + ", " + JSON.stringify(styles) +
        ", " + JSON.stringify(themes) + ")")}));
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
