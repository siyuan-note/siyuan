import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compileString} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: string[], css: string) => {
    const check: typeof assert = require("node:assert/strict");
    document.body.innerHTML = `<style>${css}
.fn__none {display:none!important}.fn__flex-1 {flex:1;min-width:0}
body {margin:0}.file-tree {position:absolute;top:40px;left:40px;width:232px}
.block__logo {overflow:hidden}#tooltip {--b3-tooltips-color:black;--b3-tooltips-background:white}
</style><div class="file-tree sy__file"><div class="block__icons">
<div class="block__logo fn__flex-1">Documents</div><div class="fn__space"></div>
<div data-type="more" class="block__icon ariaLabel" aria-label="More"><svg></svg></div>
<div class="block__icon fn__none" id="hidden"><svg></svg></div>
<div class="block__icon" disabled id="disabled"><svg></svg></div>
</div><span class="b3-tooltips" aria-label="More">More</span></div>
<div id="tooltip" class="tooltip fn__none"></div>`;
    const input = {} as typeof import("../util/hoverInput");
    new Function("exports", sources[0])(input);
    let pluginShows = 0;
    const tooltip = {} as typeof import("./tooltip");
    window.DOMPurify = {sanitize: (value: string) => value} as typeof window.DOMPurify;
    new Function("exports", "require", sources[1])(tooltip, (id: string) => {
        if (id === "../util/hoverInput") { return input; }
        return {isMobile: () => false, emitToPlugins: () => { pluginShows++; }, forEachPluginSubscriber() {}};
    });
    tooltip.initTooltips();
    input.initHoverInput();
    const more = document.querySelector<HTMLElement>('[data-type="more"]');
    const tip = document.getElementById("tooltip");
    const touch = (type = "pointerdown", pointerType = "touch") => {
        const event = new PointerEvent(type, {bubbles: true, cancelable: true, pointerType});
        more.dispatchEvent(event);
        check.equal(event.defaultPrevented, false, "input tracking leaves scrolling and activation untouched");
    };
    const hover = () => more.dispatchEvent(new MouseEvent("mouseover", {bubbles: true}));
    const assertTouch = () => {
        check.equal(input.isTouchHoverInput(), true);
        check.equal(getComputedStyle(more).display, "flex");
        check.equal(getComputedStyle(more).opacity, "1");
        check.equal(getComputedStyle(more).transitionDuration, "0s");
        check.equal(getComputedStyle(document.getElementById("hidden")).display, "none");
        check.equal(getComputedStyle(document.getElementById("disabled")).opacity, "0.38");
        check.equal(getComputedStyle(document.querySelector(".b3-tooltips"), "::after").content, "none");
    };
    check.equal(matchMedia("(hover: none)").matches, true);
    assertTouch();
    hover();
    check.equal(pluginShows, 0, "touch-generated mouseover does not build a tooltip");
    tooltip.showTooltip("Late hover", more, undefined, new MouseEvent("mouseover"));
    check.equal(pluginShows, 0, "late hover callbacks stay suppressed after touch input");
    tooltip.showTooltip("Invalid name", more, "error");
    check.equal(tip.classList.contains("tooltip--error"), true);
    check.notEqual(getComputedStyle(tip).display, "none", "validation errors remain visible");
    tooltip.showTooltip("Scroll position", more);
    check.notEqual(getComputedStyle(tip).display, "none", "explicit position feedback remains visible");
    touch("pointerover", "mouse");
    check.equal(input.isTouchHoverInput(), false);
    await new Promise(resolve => setTimeout(resolve, 350));
    check.equal(getComputedStyle(more).display, "none", "mouse input restores the toolbar hover behavior");
    await require("electron").ipcRenderer.invoke("hover", 80, 60);
    await new Promise(resolve => setTimeout(resolve, 350));
    check.equal(getComputedStyle(more).display, "flex", "real mouse hover reveals the toolbar");
    hover();
    check.equal(tip.innerHTML, "More");
    check.equal(tip.classList.contains("tooltip--hover"), true);
    touch();
    assertTouch();
    check.equal(getComputedStyle(tip).display, "none", "touch immediately hides an existing hover tooltip");
    for (const width of [200, 232, 400]) {
        const panel = document.querySelector<HTMLElement>(".file-tree");
        panel.style.width = width + "px";
        panel.style.fontSize = "32px";
        check.ok(more.getBoundingClientRect().right <= panel.getBoundingClientRect().right);
        check.equal(more.getBoundingClientRect().width, 24, "touch uses the existing control dimensions");
    }
    touch("pointerover", "pen");
    check.equal(input.isTouchHoverInput(), false, "pen hover remains available");
    tooltip.showTooltip('<a id="tipLink" href="#test">Open</a><button id="tipButton">Action</button>' +
        '<input id="tipInput" value="Editable">', more, "memo", new MouseEvent("mouseover"));
    check.equal(tip.classList.contains("tooltip--interactive"), true);
    check.equal(tip.classList.contains("tooltip--hover"), false);
    let linkClicks = 0;
    let buttonClicks = 0;
    document.getElementById("tipLink").addEventListener("click", event => {
        event.preventDefault();
        linkClicks++;
    });
    document.getElementById("tipButton").addEventListener("click", () => { buttonClicks++; });
    await new Promise(resolve => setTimeout(resolve, 500));
    for (const id of ["tipLink", "tipButton", "tipInput"]) {
        const element = document.getElementById(id);
        check.equal(tooltip.isInteractiveTooltipTarget(element), true);
        const rect = element.getBoundingClientRect();
        await require("electron").ipcRenderer.invoke("tap", rect.left + rect.width / 2, rect.top + rect.height / 2);
        await new Promise(resolve => setTimeout(resolve, 30));
        check.notEqual(getComputedStyle(tip).display, "none");
    }
    check.equal(linkClicks, 1, "a touch tap follows the link once");
    check.equal(buttonClicks, 1, "a touch tap activates the button once");
    check.equal(document.activeElement.id, "tipInput", "touch can focus the tooltip input");
    tooltip.showTooltip('<a href="#test">Interactive</a>', more, "memo", new MouseEvent("mouseover"));
    check.equal(tip.classList.contains("tooltip--interactive"), true, "interactive content remains available in touch mode");
    tooltip.hideTooltip();
    check.equal(tooltip.isInteractiveTooltipTarget(tip.firstElementChild), false, "hidden tooltips are not interactive targets");
    touch("pointerover", "mouse");
    tooltip.showTooltip("Plain", more, undefined, new MouseEvent("mouseover"));
    check.equal(tip.classList.contains("tooltip--interactive"), false, "plain content clears the interactive state");
    touch("pointermove", "touch");
    assertTouch();
    return "Touch hover input cases passed";
};

test("touch hover suppression preserves mouse, validation feedback and toolbar layout", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const sources = ["src/util/hoverInput.ts", "src/dialog/tooltip.ts"].map(file =>
        transpileModule(readFileSync(file, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText);
    const css = ["business/_block.scss", "component/_tooltips.scss", "main/_main.scss"]
        .map(file => compileString(readFileSync("src/assets/scss/" + file, "utf8")).css).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-touch-hover-test-"));
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
        await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled:true});
        ipcMain.handle("hover", (_event, x, y) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",
            {type:"mouseMoved",x,y}));
        ipcMain.handle("tap", async (_event, x, y) => {
            await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent",
                {type:"touchStart",touchPoints:[{x,y}]});
            await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {type:"touchEnd",touchPoints:[]});
        });
        const result = await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; (" +
            browserCases.toString() + ")(" + JSON.stringify(sources) + "," + JSON.stringify(css) + ")")});
        if (result !== "Touch hover input cases passed") {throw new Error(result);}
        console.log(result);
        win.destroy();app.exit(0);
    } catch(error) {console.error(error);win.destroy();app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Touch hover input cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-touch-hover-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
