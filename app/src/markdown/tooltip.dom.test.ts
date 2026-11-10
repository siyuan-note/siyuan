import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, css: string, themes: string[]) => {
    const check: typeof assert = require("node:assert/strict");
    const {ipcRenderer} = require("electron");
    const api: typeof import("./tooltip") & typeof import("./windowChrome") = new Function(source +
        "\nreturn {createMarkdownTooltips, createMarkdownWindowChrome};")();
    document.body.innerHTML = `<style>${css}</style><style id="theme"></style>
<div class="markdown-app" id="root"><header class="markdown-header"></header>
<div style="position:fixed;inset:0;overflow:hidden;transform:translateZ(0)">
<button id="edge" type="button" aria-label="Action" data-tooltip="" style="position:fixed;width:32px;height:28px">A</button>
<div id="popover" class="vditor-tooltipped vditor-tooltipped__n" aria-label="Language&lt;Alt+Enter&gt;" style="position:fixed;top:150px;left:40px"><input aria-label="Code language"></div>
<a id="content" title="Original document title" href="#document">Document content</a></div></div>`;
    const root = document.getElementById("root");
    const edge = document.getElementById("edge") as HTMLButtonElement;
    const controller = api.createMarkdownTooltips(root);
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const hover = (element: HTMLElement) => {
        root.dispatchEvent(new PointerEvent("pointerout", {bubbles: true, pointerType: "mouse"}));
        element.dispatchEvent(new PointerEvent("pointerover", {bubbles: true, pointerType: "mouse"}));
    };
    for (const [index, theme] of themes.entries()) {
        document.getElementById("theme").textContent = theme;
        for (const zoom of [1, 1.5]) {
            await ipcRenderer.invoke("tooltip-zoom", zoom); await tick();
            for (const [left, top, direction] of [[0, 32, "north"], [innerWidth - 32, 32, "east"],
                [0, innerHeight - 28, "west"], [innerWidth - 32, innerHeight - 28, "south"]] as const) {
                edge.style.left = `${left}px`; edge.style.top = `${top}px`;
                edge.dataset.tooltip = `A%2FB <tag> & long description ${"word ".repeat(40)}`;
                edge.dataset.position = direction;
                await tick(); hover(edge);
                check.equal(tooltip.hidden, false);
                const style = getComputedStyle(tooltip);
                check.equal(style.animationName, "zoomIn");
                check.equal(style.animationDelay, "0.3s");
                check.equal(style.animationDuration, "0.15s");
                check.equal(style.fontSize, "12px");
                const expected = document.createElement("div");
                expected.style.color = "var(--b3-tooltips-color)";
                expected.style.backgroundColor = "var(--b3-tooltips-background)";
                document.body.append(expected);
                check.equal(style.color, getComputedStyle(expected).color);
                check.equal(style.backgroundColor, getComputedStyle(expected).backgroundColor);
                expected.remove();
                check.equal(tooltip.textContent, edge.dataset.tooltip);
                check.equal(tooltip.querySelector("tag"), null);
                await new Promise(resolve => setTimeout(resolve, 470));
                const bounds = tooltip.getBoundingClientRect();
                const context = JSON.stringify({theme: index, zoom, direction, bounds: bounds.toJSON()});
                check.ok(bounds.left >= -0.5 && bounds.top >= -0.5, context);
                check.ok(bounds.right <= innerWidth + 0.5 && bounds.bottom <= innerHeight + 0.5, context);
                check.equal(tooltip.parentElement, document.body, "clipped or transformed editor containers do not clip tips");
            }
        }
    }
    await ipcRenderer.invoke("tooltip-zoom", 1);
    edge.style.left = "50px"; edge.style.top = "60px"; edge.disabled = true;
    edge.dataset.tooltip = "Unavailable in source mode";
    await tick();
    await ipcRenderer.invoke("tooltip-hover", 10, 10);
    await ipcRenderer.invoke("tooltip-hover", 60, 70);
    await tick();
    check.equal(tooltip.hidden, false, "real mouse movement exposes disabled control explanations");
    check.equal(tooltip.textContent, edge.dataset.tooltip);
    const popover = document.getElementById("popover");
    const input = popover.querySelector("input");
    hover(popover);
    check.equal(getComputedStyle(popover, "::before").content, "none");
    check.equal(getComputedStyle(popover, "::after").content, "none");
    check.equal(tooltip.textContent, "Language<Alt+Enter>");
    document.dispatchEvent(new KeyboardEvent("keydown", {key: "Tab", bubbles: true}));
    input.focus();
    check.equal(input.getAttribute("aria-label"), "Code language");
    check.equal(input.getAttribute("aria-describedby"), tooltip.id);
    document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    check.equal(tooltip.hidden, true);
    popover.dispatchEvent(new PointerEvent("pointermove", {bubbles: true, pointerType: "mouse"}));
    check.equal(tooltip.hidden, true);
    hover(popover);
    popover.dispatchEvent(new PointerEvent("pointerover", {bubbles: true, pointerType: "touch"}));
    check.equal(tooltip.hidden, true);
    hover(popover);
    popover.remove(); await tick();
    check.equal(tooltip.hidden, true);
    check.equal(document.getElementById("content").title, "Original document title");
    const chrome = api.createMarkdownWindowChrome({root, header: root.querySelector("header"), platform: "linux",
        bridge: {state: async () => ({maximized: false, fullscreen: false}), control: async () => {}, overlay: async () => true},
        text: key => key, onError() {throw new Error("Unexpected chrome error");}});
    await tick();
    const maximize = root.querySelector<HTMLButtonElement>('[data-action="maximize"]');
    check.equal(maximize.title, "");
    check.equal(maximize.dataset.tooltip, "max");
    hover(maximize);
    chrome.update({maximized: true, fullscreen: false}); await tick();
    check.equal(maximize.getAttribute("aria-label"), "restore");
    check.equal(maximize.dataset.tooltip, "restore");
    check.equal(tooltip.textContent, "restore");
    chrome.destroy(); controller.destroy(); controller.destroy();
    check.equal(document.querySelector('[role="tooltip"]'), null);
    check.equal(root.dataset.tooltips, undefined);
    return "Markdown tooltip DOM cases passed";
};

test("Markdown tooltips match the main UI in both themes, zoom levels and viewport corners", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-markdown-tooltip-test-"));
    const compileSource = (name: string) => transpileModule(readFileSync(path.join(__dirname, name), "utf8")
        .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
    {compilerOptions: {target: ScriptTarget.ES2022}}).outputText;
    const source = ["../menus/menuPosition.ts", "tooltip.ts", "windowChrome.ts"].map(compileSource).join("\n");
    const css = readFileSync(path.resolve(__dirname, "../../node_modules/vditor/dist/index.css"), "utf8") + "\n" +
        compile(path.resolve(__dirname, "../assets/scss/markdown.scss")).css;
    const themes = ["daylight", "midnight"].map(name => readFileSync(path.resolve(__dirname,
        `../../appearance/themes/${name}/theme.css`), "utf8"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false,width:800,height:600,
        webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        win.webContents.debugger.attach("1.3");
        ipcMain.handle("tooltip-zoom", (_event, zoom) => win.webContents.setZoomFactor(zoom));
        ipcMain.handle("tooltip-hover", (_event, x, y) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",
            {type:"mouseMoved",x,y}));
        const result = await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
            browserCases.toString() + ")(" + JSON.stringify(source) + "," + JSON.stringify(css) + "," + JSON.stringify(themes) + ")")});
        if (result !== "Markdown tooltip DOM cases passed") throw new Error(result);
        console.log(result);win.destroy();app.exit(0);
    } catch(error) {console.error(error);win.destroy();app.exit(1);}
});`, "utf8");
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(result.stdout, /Markdown tooltip DOM cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-markdown-tooltip-test-")) rmSync(temporary, {recursive: true, force: true});
    }
});
