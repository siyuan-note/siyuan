import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = (source: string, css: string, dark: boolean) => {
    const check: typeof assert = require("node:assert/strict");
    const module = {exports: {} as typeof import("./statusHover")};
    new Function("exports", source)(module.exports);
    const {syncStatusBarVisibility, updateStatusBarHover} = module.exports;
    document.head.innerHTML = `<style>${css}
html, body {margin: 0; height: 100%; width: 100%;}
body {display: flex; flex-direction: column; font-size: 36px;
    --b3-theme-background: ${dark ? "#1e1e1e" : "#fff"}; --b3-border-radius: 4px;}
.fn__flex {display: flex;} .fn__flex-1 {flex: 1; min-width: 0;}
.fn__none {display: none !important;} #editor {flex: 1;}
</style>`;
    document.body.innerHTML = `<div id="editor">Editor</div><div id="status" class="status fn__flex">
<div class="status__msg">A background message with a long description</div><div class="fn__flex-1"></div>
<div class="status__counter">Words 100 Blocks 20</div><button id="help">Help</button></div>`;
    const status = document.getElementById("status");
    const editor = document.getElementById("editor");
    const appearance = {hideStatusBar: true, showFloatingStatusBar: undefined as boolean | undefined};
    Object.assign(window, {siyuan: {config: {appearance}}});
    const open = () => status.classList.contains("status--floating-open");
    const hover = (x = innerWidth - 1, y = innerHeight - 1, buttons = 0) => updateStatusBarHover(x, y, buttons);
    syncStatusBarVisibility();
    hover();
    check.equal(getComputedStyle(status).display, "none", "old configurations keep the bar hidden");
    const editorHeight = editor.getBoundingClientRect().height;
    appearance.showFloatingStatusBar = true;
    syncStatusBarVisibility();
    check.equal(getComputedStyle(status).visibility, "hidden");
    check.equal(editor.getBoundingClientRect().height, editorHeight, "floating bar does not reserve editor space");
    hover(innerWidth - 1, innerHeight - 1, 1);
    check.equal(open(), false, "dragging cannot open the floating bar");
    hover(innerWidth - 40, innerHeight - 1);
    check.equal(open(), false);
    hover(innerWidth - 1, innerHeight - 9);
    check.equal(open(), false);
    hover();
    check.equal(open(), true);
    const rect = status.getBoundingClientRect();
    check.equal(rect.right, innerWidth);
    check.equal(rect.bottom, innerHeight);
    check.ok(rect.left >= 0, "floating bar stays inside narrow windows");
    check.equal(getComputedStyle(status).backgroundColor, dark ? "rgb(30, 30, 30)" : "rgb(255, 255, 255)");
    const button = document.getElementById("help");
    const buttonRect = button.getBoundingClientRect();
    hover(buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2);
    check.equal(open(), true, "moving from the corner onto a control keeps the bar open");
    check.equal(document.elementFromPoint(buttonRect.left + 3, buttonRect.top + 3), button);
    let clicks = 0;
    button.addEventListener("click", () => { clicks++; });
    button.click();
    check.equal(clicks, 1);
    hover(0, 0);
    check.equal(open(), false);
    hover();
    appearance.showFloatingStatusBar = false;
    syncStatusBarVisibility();
    check.equal(open(), false);
    check.equal(getComputedStyle(status).display, "none", "disabling the preference hides an open bar immediately");
    appearance.showFloatingStatusBar = true;
    appearance.hideStatusBar = false;
    syncStatusBarVisibility();
    hover();
    check.equal(status.classList.contains("status--floating"), false);
    check.equal(open(), false);
    check.equal(getComputedStyle(status).position, "static");
    check.ok(editor.getBoundingClientRect().height < editorHeight, "visible status bar occupies normal layout space");
    status.remove();
    check.doesNotThrow(syncStatusBarVisibility);
    check.doesNotThrow(() => hover());
    return "Floating status bar UI cases passed";
};

test("floating status bar preserves opt-in visibility, corner hover and editor layout in light and dark narrow windows", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "statusHover.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText;
    const css = require("sass").compile(path.resolve("src/assets/scss/main/_main.scss"), {logger: {warn() {}, debug() {}}}).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-status-hover-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 800, height: 600, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
    }});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        for (const [width, dark] of [[800, false], [360, true]]) {
            win.setContentSize(width, 400);
            console.log(await win.webContents.executeJavaScript("(() => {const __name = value => value; return (" +
                ${JSON.stringify(browserCases.toString())} + ")(" + ${JSON.stringify(JSON.stringify(source))} + "," +
                ${JSON.stringify(JSON.stringify(css))} + "," + dark + ");})()"));
        }
        win.destroy(); app.exit(0);
    } catch (error) {console.error(error); win.destroy(); app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Floating status bar UI cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-status-hover-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
