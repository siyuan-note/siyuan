import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ScriptTarget, transpileModule} from "typescript";
import {compile} from "sass";

const browserCases = async (source: string, css: string) => {
    const check: typeof assert = require("node:assert/strict");
    let mobile = false;
    const update = new Function("isMobile", source + "\nreturn updateBackgroundActions;")(() => mobile);
    const style = document.createElement("style");
    style.textContent = css + ".protyle-background__action {transition: none}";
    document.head.append(style);
    document.body.innerHTML = `<div class="protyle"><div class="protyle-top">
        <div class="protyle-background protyle-background--enable"><div class="protyle-background__action">
            <button>Add tag</button><button>Add icon</button><button>Add cover</button>
        </div></div><div class="protyle-db-attr">Database tabs and fields</div>
    </div></div>`;
    const element = document.querySelector<HTMLElement>(".protyle");
    const background = document.querySelector<HTMLElement>(".protyle-background");
    const actions = document.querySelector<HTMLElement>(".protyle-background__action");
    const panel = document.querySelector<HTMLElement>(".protyle-db-attr");
    const protyle = {element, background: {element: background}, block: {id: "document", rootID: "document", showAll: false}};
    const hover = (enabled: boolean) => require("electron").ipcRenderer.invoke("header-hover", enabled);
    const visible = () => getComputedStyle(actions).display !== "none";
    for (mobile of [false, true]) {
        await hover(false);
        delete element.dataset.databaseRowId;
        protyle.block = {id: "document", rootID: "document", showAll: false};
        update(protyle);
        check.equal(visible(), true);
        check.equal(getComputedStyle(actions).opacity, mobile ? "0.86" : "0", "ordinary document behavior is preserved");
        await hover(true);
        check.equal(getComputedStyle(actions).opacity, "0.86", "desktop document actions remain available on hover");
        element.dataset.databaseRowId = "bound";
        protyle.block = {id: "bound", rootID: "document", showAll: true};
        update(protyle);
        check.equal(visible(), false, "database-bound blocks hide document actions even while the header is hovered");
        check.notEqual(getComputedStyle(panel).display, "none", "database tabs and fields remain available");
        background.classList.remove("protyle-background--enable");
        update(protyle);
        background.classList.add("protyle-background--enable");
        update(protyle);
        check.equal(visible(), false, "unlocking a bound block does not reveal document actions");
        await hover(false);
        element.dataset.databaseRowId = "document";
        protyle.block = {id: "document", rootID: "document", showAll: true};
        update(protyle);
        check.equal(visible(), true, "document rows retain document actions after switching or restoring a tab");
        check.equal(getComputedStyle(actions).opacity, mobile ? "0.86" : "0");
        background.classList.remove("protyle-background--enable");
        update(protyle);
        check.equal(visible(), false, "readonly documents hide actions on both platforms");
        background.classList.add("protyle-background--enable");
        element.dataset.databaseRowId = "bound";
        protyle.block = {id: "bound", rootID: "document", showAll: true};
        update(protyle);
        protyle.block = {id: "document", rootID: "document", showAll: false};
        update(protyle);
        check.equal(visible(), true, "exiting block focus restores document actions");
        check.equal(getComputedStyle(actions).opacity, mobile ? "0.86" : "0");
        protyle.block = {id: "other-block", rootID: "document", showAll: true};
        update(protyle);
        check.equal(visible(), true, "ordinary block navigation does not inherit another row's hidden state");
        delete element.dataset.databaseRowId;
        protyle.block.id = "bound";
        update(protyle);
        check.equal(visible(), true, "ordinary focused blocks retain their existing behavior");
    }
    update({});
    return "Background action cases passed";
};

test("database row header actions follow the opened object on desktop and mobile", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "backgroundActions.ts"), "utf8")
        .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""),
    {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const css = compile("src/assets/scss/protyle/_protyle.scss").css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-background-actions-test-"));
    const script = path.join(temporary, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(source) + "," + JSON.stringify(css) + ")";
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: true, contextIsolation: false}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("DOM.enable");
        await win.webContents.debugger.sendCommand("CSS.enable");
        ipcMain.handle("header-hover", async (_event, enabled) => {
            const {root} = await win.webContents.debugger.sendCommand("DOM.getDocument");
            const {nodeId} = await win.webContents.debugger.sendCommand("DOM.querySelector", {nodeId: root.nodeId, selector: ".protyle-top"});
            await win.webContents.debugger.sendCommand("CSS.forcePseudoState", {nodeId, forcedPseudoClasses: enabled ? ["hover"] : []});
        });
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Background action cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-background-actions-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
