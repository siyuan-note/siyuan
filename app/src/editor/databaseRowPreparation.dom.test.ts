import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {compile} from "sass";

const cases = async (source: string, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css + "html {height: 100vh} body {width: 100%; display: flex; flex-direction: column}";
    document.head.append(style);
    Object.assign(window, {siyuan: {config: {editor: {databaseAttrShow: true}}}});
    for (const width of [480, 1280]) {
        for (const fontSize of [16, 32]) {
            for (const result of ["success", "missing-attributes", "cancelled"]) {
                document.body.style.width = `${width}px`;
                document.body.style.fontSize = `${fontSize}px`;
                document.body.innerHTML = '<main class="fn__flex-1 fn__flex" style="min-height:0">' +
                    '<section class="fn__flex-1 fn__flex-column" style="min-width:0;overflow:hidden">' +
                    '<div class="fn__flex-1">Original preview</div></section><aside style="width:80px">Dock</aside>' +
                    '</main><footer style="height:32px;flex-shrink:0">Status</footer>';
                const main = document.querySelector("main");
                const original = document.querySelector("section > div");
                const destination = original.parentElement;
                const footer = document.querySelector("footer");
                const before = {height: main.getBoundingClientRect().height, footer: footer.getBoundingClientRect().top};
                const panel = document.createElement("div");
                panel.className = "fn__flex-1 fn__flex-column";
                panel.innerHTML = '<div style="height:2000px;flex-shrink:0">Loading editor</div>';
                let ready: (body: HTMLElement) => void;
                class Custom {}
                class Editor {
                    editor = {resize() {}, protyle: {element: panel, contentElement: panel, block: {}, databaseAttributePanel: {
                        expand() {}, afterRender(callback: typeof ready) { ready = callback; },
                    }}};
                    destroy() {} send() {}
                }
                const wnd = {addTab() { original.replaceWith(panel); }};
                const model = Object.assign(new Custom(), {parent: {parent: wnd, panelElement: original, model: undefined as unknown}, app: {}});
                model.parent.model = model;
                const dependencies = {Custom, Editor, inheritDatabaseRowReadonly() {}, updateBackgroundActions() {},
                    mountDatabaseRowNavigation() {}, focusDatabasePrimary() {}, saveLayout() {}, updatePanelByEditor() {},
                    fetchSyncPost: async () => ({code: 0, data: {rootID: "bound"}}),
                    newTab: (_options: unknown, loaded: () => void) => ({panelElement: panel, model: undefined as unknown,
                        callback(tab: {model: Editor}) { tab.model = new Editor(); queueMicrotask(loaded); }}),
                };
                const api = new Function("require", "const exports = {};\n" + source + "\nreturn exports;")(() => dependencies);
                const switching = api.switchDesktopDatabaseRowPreview(model, {avID: "database", databaseBlockID: "carrier",
                    notebookID: "notebook", itemID: "item", valueID: "value", title: "Bound", boundBlockID: "bound", isDetached: false}, {});
                await new Promise(requestAnimationFrame);
                await new Promise(requestAnimationFrame);
                check.equal(typeof ready, "function", "the target reaches attribute preparation");
                check.equal(main.getBoundingClientRect().height, before.height, "loading cannot shrink the main layout");
                check.equal(footer.getBoundingClientRect().top, before.footer, "loading cannot move the status bar");
                check.equal(panel.getBoundingClientRect().width, original.getBoundingClientRect().width,
                    "the target measures at the source pane width");
                check.equal(getComputedStyle(panel).visibility, "hidden");
                check.equal(panel.closest(".fn__none"), null, "the attribute request owner remains live");
                const preparation = panel.parentElement;
                if (result === "cancelled") original.remove();
                else {
                    const body = document.createElement("div");
                    if (result === "success") body.innerHTML = '<div data-av-id="database"></div>';
                    ready(body);
                }
                check.equal(await switching, result === "success");
                check.equal(preparation.isConnected, false, "all outcomes clean up the preparation container");
                if (result === "success") {
                    check.equal(panel.parentElement, destination);
                    check.equal(getComputedStyle(panel).visibility, "visible");
                    check.equal(panel.style.position, "", "preparation does not change the target positioning frame");
                } else {
                    check.equal(panel.isConnected, false);
                    check.equal(original.isConnected, result !== "cancelled");
                }
            }
        }
    }
    return "Database row preparation layout cases passed";
};

test("database row preparation preserves browser layout, target sizing and cleanup", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const {parse} = require("ifdef-loader/preprocessor");
    const source = transpileModule(parse(readFileSync("src/protyle/render/av/openDatabaseRow.ts", "utf8"),
        {MOBILE: false, BROWSER: true}, false, true),
    {compilerOptions: {target: ScriptTarget.ES2022, module: ModuleKind.CommonJS}}).outputText;
    const css = compile(path.resolve("src/assets/scss/base.scss"), {logger: {warn() {}, debug() {}}}).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-row-preparation-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + cases.toString() + ")(" + JSON.stringify(source) + "," + JSON.stringify(css) + ")";
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 1280, height: 800,
        webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const {stdout} = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 40000});
        assert.match(stdout, /Database row preparation layout cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-row-preparation-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
