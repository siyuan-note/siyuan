import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (vendor: string) => {
    const check = require("node:assert/strict");
    const {ipcRenderer} = require("electron");
    const api = (window as unknown as {copyTest: typeof import("./tooltip")}).copyTest;
    Object.assign(window, {VditorI18n: {copy: "Copy", copied: "Copied"}});
    const Vditor = require(vendor);
    const root = document.createElement("div");
    root.className = "markdown-app";
    root.style.cssText = "position:fixed;inset:0;width:800px;height:600px;box-sizing:border-box;padding:40px";
    root.innerHTML = '<textarea id="source">keep source selection</textarea><div class="vditor-reset"><pre><code>let answer = 42;\n</code></pre></div>';
    document.body.append(root);
    Vditor.codeRender(root);
    const controller = api.createMarkdownTooltips(root);
    const button = root.querySelector<HTMLElement>(".vditor-copy > span");
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
    const source = root.querySelector("#source") as HTMLTextAreaElement;
    let succeed = true;
    let copied = "";
    // The headless host has no OS clipboard. Keep the native input/focus/tooltip chain,
    // and inspect the actual selected code at the clipboard boundary only.
    document.execCommand = command => {
        check.equal(command, "copy");
        const selected = document.activeElement as HTMLTextAreaElement;
        copied = selected.value.slice(selected.selectionStart, selected.selectionEnd);
        return succeed;
    };
    const tick = () => new Promise(resolve => setTimeout(resolve, 80));
    const activate = async (key?: string) => {
        if (key === "touch") {
            const rect = button.getBoundingClientRect();
            await ipcRenderer.invoke("copy-touch", Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2));
        } else if (key) {
            button.focus();
            await ipcRenderer.invoke("copy-input", {type: "keyDown", keyCode: key});
            await ipcRenderer.invoke("copy-input", {type: "keyUp", keyCode: key});
        } else {
            source.focus(); source.setSelectionRange(2, 7);
            const pre = root.querySelector("pre").getBoundingClientRect();
            await ipcRenderer.invoke("copy-input", {type: "mouseMove", x: Math.round(pre.left + 10), y: Math.round(pre.top + 10)});
            await tick();
            const rect = button.getBoundingClientRect();
            const x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2);
            await ipcRenderer.invoke("copy-input", {type: "mouseMove", x, y});
            await tick();
            check.ok(button.contains(document.elementFromPoint(x, y)), JSON.stringify({x, y, hit: document.elementFromPoint(x, y)?.outerHTML, button: button.outerHTML, rect: rect.toJSON(), pre: pre.toJSON(), preHover: root.querySelector("pre").matches(":hover"), preStyle: getComputedStyle(root.querySelector("pre")).display}));
            await ipcRenderer.invoke("copy-input", {type: "mouseDown", x, y, button: "left", clickCount: 1});
            await ipcRenderer.invoke("copy-input", {type: "mouseUp", x, y, button: "left", clickCount: 1});
        }
        await tick();
    };
    try {
        for (const key of [undefined, "Enter", "Space", "touch"]) {
            await activate(key);
            check.equal(copied, "let answer = 42;");
            check.equal(tooltip.hidden, false, `visible feedback after ${key || "mouse click"}`);
            check.equal(tooltip.textContent, "Copied");
            await new Promise(resolve => setTimeout(resolve, 200));
            check.notEqual(getComputedStyle(tooltip).visibility, "hidden");
            check.ok(Number(getComputedStyle(tooltip).opacity) > 0);
            check.ok(tooltip.getClientRects().length > 0);
            check.equal(document.activeElement, button, "copy restores the focused button");
            check.equal(source.selectionStart, 2);
            check.equal(source.selectionEnd, 7);
        }
        await new Promise(resolve => setTimeout(resolve, 1600));
        check.equal(tooltip.hidden, true, "confirmation expires");
        check.equal(button.getAttribute("aria-label"), "Copy");
        source.focus(); button.focus(); await tick();
        check.ok(tooltip.hidden || tooltip.textContent !== "Copied", "focus cannot resurrect stale confirmation");
        // Source-mode programmatic activation retains its pre-existing selection.
        source.focus(); source.setSelectionRange(3, 9); button.click(); await tick();
        check.equal(document.activeElement, source);
        check.equal(source.selectionStart, 3); check.equal(source.selectionEnd, 9);
        check.equal(tooltip.hidden, false);
        succeed = false;
        await activate();
        check.ok(tooltip.hidden || tooltip.textContent !== "Copied", "failed copy has no stale success feedback");
        check.equal(button.getAttribute("aria-label"), "Copy");
    } finally {
        controller.destroy(); root.remove();
    }
    check.equal(document.querySelector('[role="tooltip"]'), null);
    return "copy-feedback-passed";
};

test("Markdown copy shows visible success after native mouse and keyboard input", {timeout: 45000}, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "siyuan-copy-feedback-"));
    const source = ["../menus/menuPosition.ts", "tooltip.ts"].map(file =>
        transpileModule(readFileSync(path.join(__dirname, file), "utf8")
            .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2022}}).outputText).join("\n");
    const css = readFileSync(path.resolve(__dirname, "../../node_modules/vditor/dist/index.css"), "utf8") + "\n" +
        compile(path.resolve(__dirname, "../assets/scss/markdown.scss")).css + "\n" +
        readFileSync(path.resolve(__dirname, "../../appearance/themes/daylight/theme.css"), "utf8");
    const renderer = `${source}\nwindow.copyTest={createMarkdownTooltips};
        const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);
        const __name=value=>value; (${browserCases.toString()})(${JSON.stringify(path.resolve(__dirname, "../../node_modules/vditor"))})`;
    const script = path.join(directory, "run.cjs");
    writeFileSync(script, `const {app,BrowserWindow,ipcMain}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(directory, "profile"))});app.disableHardwareAcceleration();
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:800,height:600,
webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true,backgroundThrottling:false}});
try{await win.loadURL('about:blank');win.webContents.debugger.attach('1.3');
await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:800,height:600,deviceScaleFactor:1,mobile:false});
await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
ipcMain.handle('copy-touch',async (_e,x,y)=>{await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})});
ipcMain.handle('copy-input',(_e,input)=>input.type.startsWith('mouse') ? win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:({mouseMove:'mouseMoved',mouseDown:'mousePressed',mouseUp:'mouseReleased'})[input.type],x:input.x,y:input.y,button:input.button||'none',clickCount:input.clickCount||0}) : win.webContents.sendInputEvent(input));
console.log(await win.webContents.executeJavaScript(${JSON.stringify(renderer)}));app.exit(0);
}catch(e){console.error(e);app.exit(1)}});`);
    const env: NodeJS.ProcessEnv = {...process.env, XDG_CACHE_HOME: path.join(directory, "cache")};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const args = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ?
            ["--no-sandbox", "--ozone-platform=headless", script] : [script];
        const result = await promisify(execFile)(require("electron") as unknown as string, args,
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /copy-feedback-passed/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
