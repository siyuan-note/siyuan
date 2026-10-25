import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (sources: string[], css: string, nativeEnabled = true) => {
    const check: typeof assert = require("node:assert/strict");
    const {webFrame} = require("electron") as typeof import("electron");
    document.body.innerHTML = `<style>${css}
    :root{--b3-ui-panel-height:42px;--b3-ui-toolbar-height:32px;--b3-toolbar-color:#555555}
    .fn__flex{display:flex}.fn__flex-1{flex:1;min-width:0}.fn__none{display:none!important}
    .toolbar{padding:0}body{margin:0}#tooltip{--b3-tooltips-background:black;--b3-tooltips-color:white}
    </style><div id="toolbar" class="toolbar fn__flex"><div id="drag" class="fn__flex-1"></div>
    <div id="windowControls" class="fn__flex"></div></div>
    <div><div class="layout-tab-bar"></div></div><div id="tooltip" class="tooltip fn__none"></div>`;
    window.siyuan = {isReady: true, languages: {min: "Minimize", max: "Maximize", restore: "Restore", close: "Close"},
        storage: {zoom: 1}} as unknown as typeof window.siyuan;
    window.DOMPurify = {sanitize: (value: string) => value} as typeof window.DOMPurify;
    let resizeCalls = 0;
    const overlay = {} as typeof import("./windowControlsOverlay");
    const controls = {} as typeof import("./windowControls");
    const tooltip = {} as typeof import("../dialog/tooltip");
    const dependencies = {Constants: {SIYUAN_CMD: "siyuan-cmd", LOCAL_ZOOM: "zoom"},
        resizeTopBar: () => { resizeCalls++; }, setToolbarLeftMac() {},
        isMobile: () => false, isTouchHoverInput: () => false, emitToPlugins() {}, forEachPluginSubscriber() {}};
    const load = (code: string, exports: object) => new Function("exports", "require", code)(exports, (id: string) => {
        if (id === "electron") return require("electron");
        if (id === "./windowControlsOverlay") return overlay;
        return dependencies;
    });
    load(sources[0], overlay);
    load(sources[1], controls);
    load(sources[2], tooltip);
    const container = document.getElementById("windowControls");
    document.body.className = "body--linux";
    let closed = 0;
    controls.initWindowControls(container, () => { closed++; });
    check.equal(container.querySelectorAll("#minWindow,#maxWindow,#restoreWindow,#closeWindow").length, 4);
    container.querySelector<HTMLElement>("#closeWindow").click();
    check.equal(closed, 1);
    check.equal(document.documentElement.classList.contains("window-controls-overlay"), false);
    container.replaceChildren();
    document.body.className = "body--windows";
    if (!nativeEnabled) {
        controls.initWindowControls(container, () => { closed++; });
        check.equal(container.querySelectorAll("#minWindow,#maxWindow,#restoreWindow,#closeWindow").length, 4,
            "Windows hosts without an enabled overlay retain self-drawn controls after a frontend refresh");
        check.equal(document.documentElement.classList.contains("window-controls-overlay"), false);
        return "Window controls overlay cases passed";
    }
    controls.initWindowControls(container, () => { closed++; });
    check.equal(container.children.length, 0, "native controls replace the self-drawn buttons");
    const api = (navigator as Navigator & {windowControlsOverlay: import("./windowControlsOverlay").IWindowControlsOverlay}).windowControlsOverlay;
    for (const fused of [false, true]) for (const zoom of [0.67, 1, 1.5]) {
        document.body.classList.toggle("body--toolbar-hide", fused);
        webFrame.setZoomFactor(zoom);
        overlay.updateWindowControlsOverlay();
        await new Promise(resolve => setTimeout(resolve, 300));
        const safe = api.getTitlebarAreaRect();
        const rect = container.getBoundingClientRect();
        check.ok(Math.abs(rect.left - safe.right) < 1.5);
        check.ok(Math.abs(rect.right - innerWidth) < 1.5);
        check.ok(document.getElementById("toolbar").getBoundingClientRect().height >= safe.height - 1);
        const target = document.createElement("span");
        target.style.cssText = `position:fixed;right:${innerWidth - safe.right + 2}px;top:4px;width:20px;height:18px`;
        document.body.append(target);
        tooltip.showTooltip("A long caption tooltip that extends into the native buttons", target);
        const tip = document.getElementById("tooltip");
        check.ok(parseFloat(tip.style.top) >= safe.bottom + 4, "tooltip avoids the native caption before animation");
        check.ok(parseFloat(tip.style.maxHeight) <= innerHeight - parseFloat(tip.style.top));
        tooltip.showTooltip('<a href="#test">An interactive caption tooltip</a>', target, "memo");
        check.equal(tip.classList.contains("tooltip--interactive"), true);
        check.ok(parseFloat(tip.style.top) >= safe.bottom + 4);
        tooltip.hideTooltip();
        target.remove();
    }
    webFrame.setZoomFactor(0.67);
    document.body.classList.remove("body--toolbar-hide");
    overlay.updateWindowControlsOverlay();
    await new Promise(resolve => setTimeout(resolve, 300));
    document.body.classList.add("body--fullscreen");
    overlay.updateWindowControlsOverlay();
    check.equal(container.getBoundingClientRect().width, 0, "fullscreen releases stale native geometry");
    check.ok(document.getElementById("toolbar").getBoundingClientRect().height <= 32.1);
    document.body.classList.remove("body--fullscreen");
    overlay.updateWindowControlsOverlay();
    check.ok(container.getBoundingClientRect().width > 0);
    const wide = document.createElement("div");
    wide.style.cssText = "width:2000px;flex-shrink:0";
    document.getElementById("toolbar").prepend(wide);
    overlay.updateWindowControlsOverlay();
    check.ok(resizeCalls > 0, "overflow uses the existing toolbar folding logic");
    wide.remove();
    return "Window controls overlay cases passed";
};

test("native Windows captions reserve geometry, preserve legacy controls and keep tooltips clear", {
    skip: process.platform !== "win32", timeout: 20000,
}, async () => {
    const sources = ["src/boot/windowControlsOverlay.ts", "src/boot/windowControls.ts", "src/dialog/tooltip.ts"].map(file =>
        transpileModule(readFileSync(file, "utf8"), {compilerOptions: {
            module: ModuleKind.CommonJS, target: ScriptTarget.ES2021,
        }}).outputText);
    const css = ["main/_main.scss", "util/_reset.scss", "component/_tooltips.scss"]
        .map(file => compile("src/assets/scss/" + file).css).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-window-controls-overlay-"));
    const script = path.join(temporary, "run.cjs");
    const html = path.join(temporary, "index.html");
    writeFileSync(html, "<!doctype html><html><head></head><body></body></html>", "utf8");
    writeFileSync(script, `const {app,BrowserWindow,ipcMain}=require("electron");
const {updateTitleBarOverlay}=require(${JSON.stringify(path.resolve("electron/windowControlsOverlay.js"))});
app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:800,height:600,frame:false,titleBarStyle:"hidden",
 titleBarOverlay:{color:"#00000000"},webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
 ipcMain.on("siyuan-cmd",(event,data)=>{if(data.cmd==="setTitleBarOverlay")updateTitleBarOverlay(win,data);});
 try{
 const legacy=new BrowserWindow({show:false,width:800,height:600,frame:false,titleBarStyle:"hidden",
 webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
 await legacy.loadFile(${JSON.stringify(html)});
 const fallback=await legacy.webContents.executeJavaScript(${JSON.stringify("const __name=value=>value;(" +
        browserCases.toString() + ")(" + JSON.stringify(sources) + "," + JSON.stringify(css) + ",false)")});
 if(fallback!=="Window controls overlay cases passed")throw new Error(fallback);
 legacy.destroy();
 await win.loadFile(${JSON.stringify(html)});
 const result=await win.webContents.executeJavaScript(${JSON.stringify("const __name=value=>value;(" +
        browserCases.toString() + ")(" + JSON.stringify(sources) + "," + JSON.stringify(css) + ")")});
 console.log(result);win.destroy();app.exit(0);
 }catch(error){console.error(error);win.destroy();app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 15000, windowsHide: true});
        assert.match(result.stdout, /Window controls overlay cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-window-controls-overlay-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
