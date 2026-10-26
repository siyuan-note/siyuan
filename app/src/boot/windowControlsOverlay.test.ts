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
    const {webFrame, ipcRenderer} = require("electron") as typeof import("electron");
    const sent: Array<{cmd: string, height: number, symbolColor?: string}> = [];
    document.body.innerHTML = `<style>${css}
    :root{--b3-ui-panel-height:42px;--b3-ui-toolbar-height:32px;--b3-toolbar-color:#555555}
    .fn__flex{display:flex}.fn__flex-1{flex:1;min-width:0}.fn__none{display:none!important}
    .toolbar{padding:0}body{margin:0}#tooltip{--b3-tooltips-background:black;--b3-tooltips-color:white}
    </style><div id="toolbar" class="toolbar fn__flex"><div id="captionColor" class="toolbar__item"></div><div id="drag" class="fn__flex-1"></div>
    <div id="windowControls" class="fn__flex"></div></div>
    <div id="tooltip" class="tooltip fn__none"></div>`;
    window.siyuan = {isReady: true, languages: {min: "Minimize", max: "Maximize", restore: "Restore", close: "Close"},
        storage: {zoom: 1}} as unknown as typeof window.siyuan;
    window.DOMPurify = {sanitize: (value: string) => value} as typeof window.DOMPurify;
    let resizeCalls = 0;
    const overlay = {} as typeof import("./windowControlsOverlay");
    const controls = {} as typeof import("./windowControls");
    const tooltip = {} as typeof import("../dialog/tooltip");
    const color = {} as typeof import("../util/color");
    const dependencies = {Constants: {SIYUAN_CMD: "siyuan-cmd", LOCAL_ZOOM: "zoom"},
        resizeTopBar: () => { resizeCalls++; }, setToolbarLeftMac() {},
        isMobile: () => false, isTouchHoverInput: () => false, emitToPlugins() {}, forEachPluginSubscriber() {}};
    const load = (code: string, exports: object) => new Function("exports", "require", code)(exports, (id: string) => {
        if (id === "electron") return {webFrame, ipcRenderer: {send: (channel: string, data: typeof sent[number]) => {
            if (data?.cmd === "setTitleBarOverlay") sent.push(data);
            ipcRenderer.send(channel, data);
        }}};
        if (id === "./windowControlsOverlay") return overlay;
        if (id === "../util/color") return color;
        return dependencies;
    });
    load(sources[3], color);
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
    const colors = [
        {css: "oklch(70% .15 150)", rgba: [76, 184, 106, 1]},
        {css: "oklab(0.6 0 0)", rgba: [128, 128, 128, 1]},
        {css: "color(display-p3 1 0 0 / .5)", rgba: [255, 0, 0, 128 / 255]},
        {css: "color-mix(in oklch, red 50%, transparent)", rgba: [255, 0, 0, 128 / 255]},
        {css: "#123456", rgba: [18, 52, 86, 1]},
        {css: "rgba(255, 0, 0, 0)", rgba: [0, 0, 0, 0]},
    ];
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
        for (const color of colors) {
            document.getElementById("captionColor").style.color = color.css;
            overlay.updateWindowControlsOverlay();
            await new Promise(resolve => setTimeout(resolve, 100));
            const style = sent.at(-1);
            check.equal(style.symbolColor, `rgba(${color.rgba.join(", ")})`, `${color.css}, fused=${fused}, zoom=${zoom}`);
            check.ok(Math.abs(api.getTitlebarAreaRect().height * zoom - style.height) < 1.5,
                "modern theme colors must not block native height updates");
            const applied = await ipcRenderer.invoke("overlay-test-state");
            overlay.updateWindowControlsOverlay();
            check.deepEqual(await ipcRenderer.invoke("overlay-test-state"), applied,
                "unchanged color and geometry do not repeat native updates");
        }
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
    // 原生按钮跟随界面密度和缩放，不能被初始化时的系统默认高度抬高。
    const densities = [["comfortable", 32, 42], ["compact", 28, 34]] as const;
    for (const [density, toolbarHeight, panelHeight] of densities) {
        if (density === "compact") {
            document.documentElement.setAttribute("data-ui-density", "compact");
        } else {
            document.documentElement.removeAttribute("data-ui-density");
        }
        document.documentElement.style.setProperty("--b3-ui-toolbar-height", toolbarHeight + "px");
        document.documentElement.style.setProperty("--b3-ui-panel-height", panelHeight + "px");
        for (const fused of [false, true]) for (const zoom of [0.67, 1, 1.5]) {
            document.body.classList.toggle("body--toolbar-hide", fused);
            webFrame.setZoomFactor(zoom);
            overlay.updateWindowControlsOverlay();
            await new Promise(resolve => setTimeout(resolve, 300));
            const expected = fused ? panelHeight : toolbarHeight;
            const label = `${density} ${fused ? "fused" : "toolbar"} at zoom ${zoom}`;
            check.equal(sent.at(-1).height, Math.round(expected * zoom), `${label} caption height`);
            check.ok(Math.abs(api.getTitlebarAreaRect().height - expected) < 1.5,
                `${label} caption keeps ${expected}px`);
            check.ok(Math.abs(document.getElementById("toolbar").getBoundingClientRect().height - expected) < 1.5,
                `${label} toolbar keeps ${expected}px`);
        }
        document.documentElement.style.removeProperty("--b3-ui-toolbar-height");
        document.documentElement.style.removeProperty("--b3-ui-panel-height");
    }
    document.documentElement.removeAttribute("data-ui-density");
    const icon = document.getElementById("captionColor");
    icon.style.color = "#aabbcc";
    await ipcRenderer.invoke("overlay-test-reject-color");
    overlay.updateWindowControlsOverlay();
    const rejected = await ipcRenderer.invoke("overlay-test-state");
    check.equal(rejected.rejections, 1);
    overlay.updateWindowControlsOverlay();
    const retried = await ipcRenderer.invoke("overlay-test-state");
    check.equal(retried.symbolColor, "rgba(170, 187, 204, 1)", "an unchanged renderer request retries a failed native color");
    check.equal(retried.rejections, 1);

    icon.style.color = "#fedcba";
    document.documentElement.style.setProperty("--b3-ui-panel-height", "46px");
    const readPixels = CanvasRenderingContext2D.prototype.getImageData;
    try {
        CanvasRenderingContext2D.prototype.getImageData = () => { throw new Error("canvas temporarily unavailable"); };
        overlay.updateWindowControlsOverlay();
        check.equal(sent.at(-1).symbolColor, undefined);
        const partial = await ipcRenderer.invoke("overlay-test-state");
        check.equal(partial.height, 69, "a conversion failure still updates the native height");
        check.equal(partial.symbolColor, retried.symbolColor, "a conversion failure keeps the applied symbol color");
    } finally {
        CanvasRenderingContext2D.prototype.getImageData = readPixels;
    }
    overlay.updateWindowControlsOverlay();
    check.equal((await ipcRenderer.invoke("overlay-test-state")).symbolColor, "rgba(254, 220, 186, 1)",
        "color conversion recovers without changing the requested CSS color");
    document.documentElement.style.removeProperty("--b3-ui-panel-height");
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
    skip: process.platform !== "win32", timeout: 30000,
}, async () => {
    const sources = ["src/boot/windowControlsOverlay.ts", "src/boot/windowControls.ts", "src/dialog/tooltip.ts",
        "src/util/color.ts"].map(file =>
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
 const nativeSet=win.setTitleBarOverlay.bind(win);
 const state={updates:0,rejections:0,height:undefined,symbolColor:undefined};let rejectColor=false;
 win.setTitleBarOverlay=style=>{
  if(rejectColor&&style.symbolColor){rejectColor=false;state.rejections++;throw new Error("temporary native color failure");}
  nativeSet(style);state.updates++;
  if(style.height!==undefined)state.height=style.height;
  if(style.symbolColor!==undefined)state.symbolColor=style.symbolColor;
 };
 ipcMain.handle("overlay-test-state",()=>({...state}));
 ipcMain.handle("overlay-test-reject-color",()=>{rejectColor=true;});
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
 if(updateTitleBarOverlay(win,{height:55,symbolColor:"oklch(0.7 0.15 150)"})!==false)throw new Error("native parser unexpectedly accepted oklch");
 const captionHeight=()=>win.webContents.executeJavaScript("navigator.windowControlsOverlay.getTitlebarAreaRect().height");
 const waitCaption=async expected=>{
  let height=0;
  for(let index=0;index<40&&height!==expected;index++){
   await new Promise(resolve=>setTimeout(resolve,50));
   height=await captionHeight();
  }
  if(height!==expected)throw new Error("native caption height stayed "+height+" instead of "+expected);
 };
 await waitCaption(55);
 updateTitleBarOverlay(win,{height:32,symbolColor:"#808080"});
 await waitCaption(32);
 const result=await win.webContents.executeJavaScript(${JSON.stringify("const __name=value=>value;(" +
        browserCases.toString() + ")(" + JSON.stringify(sources) + "," + JSON.stringify(css) + ")")});
 console.log(result);win.destroy();app.exit(0);
 }catch(error){console.error(error);win.destroy();app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Window controls overlay cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-window-controls-overlay-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
