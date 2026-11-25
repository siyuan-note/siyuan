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
    .fn__flex{display:flex}.fn__flex-1{flex:1;min-width:0}.fn__none{display:none!important}.fn__hidden{visibility:hidden!important}
    .toolbar{padding:0}body{margin:0}#tooltip{--b3-tooltips-background:black;--b3-tooltips-color:white}
    .fixture-tab-row{height:42px;display:flex;overflow:hidden}
    .fixture-tabs{margin:0;padding:0;display:flex;overflow:hidden;min-width:0}
    .fixture-tabs .item--readonly{display:flex;width:100%;margin:0}
    .fixture-tabs button{flex:0 0 24px}
    </style><div id="toolbar" class="toolbar fn__flex"><div id="captionColor" class="toolbar__item"></div><div id="drag" class="fn__flex-1"></div>
    <div class="toolbar__item" id="rightToolbarButton"></div><div class="toolbar__window-gap"></div>
    <div id="windowControls" class="fn__flex"></div></div>
    <div id="tooltip" class="tooltip fn__none"></div>`;
    document.documentElement.dataset.frontend = "desktop";
    window.siyuan = {isReady: true, languages: {min: "Minimize", max: "Maximize", restore: "Restore", close: "Close"},
        storage: {zoom: 1}, config: {appearance: {hideToolbar: true}, system: {os: "windows"}}, layout: {},
        zIndex: 10} as unknown as typeof window.siyuan;
    window.DOMPurify = {sanitize: (value: string) => value} as typeof window.DOMPurify;
    let resizeCalls = 0;
    const overlay = {} as typeof import("./windowControlsOverlay");
    const controls = {} as typeof import("./windowControls");
    const tooltip = {} as typeof import("../dialog/tooltip");
    const color = {} as typeof import("../util/color");
    const tabUtil = {} as typeof import("../layout/tabUtil");
    let tabRows: {element: HTMLElement; headersElement: HTMLElement}[] = [];
    const dependencies = {Constants: {SIYUAN_CMD: "siyuan-cmd", LOCAL_ZOOM: "zoom", TIMEOUT_TRANSITION: 0},
        resizeTopBar: () => { resizeCalls++; }, setToolbarLeftMac() {},
        isMobile: () => false, isWindow: () => false, isTouchHoverInput: () => false, emitToPlugins() {},
        forEachPluginSubscriber() {}, getAllWnds(_layout: unknown, rows: typeof tabRows) { rows.push(...tabRows); }, hideAllElements() {},
        hasClosestByClassName: (element: Element, name: string) => element.closest("." + name)};
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
    const panelFullscreen = {} as typeof import("../protyle/breadcrumb/action");
    load(sources[4], panelFullscreen);
    load(sources[5], tabUtil);
    const container = document.getElementById("windowControls");
    const waitForPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const checkAdaptiveGap = async (platform: "windows" | "linux" | "mac", native = false) => {
        document.body.className = `body--${platform} body--toolbar-hide`;
        window.siyuan.config.system.os = platform === "mac" ? "darwin" : platform;
        const gap = document.querySelector<HTMLElement>(".toolbar__window-gap");
        const center = document.createElement("div");
        center.style.cssText = "position:absolute;inset:0 0 auto";
        center.innerHTML = `<section><div class="fixture-tab-row">
  <ul class="fixture-tabs" style="width:100px"><li>Tab</li></ul>
  <ul class="fixture-tabs fn__flex-1"><li class="item--readonly"><button type="button">+</button><span class="fn__flex-1"></span><button type="button">v</button></li></ul>
</div><div class="layout-tab-container"></div></section>`;
        document.body.append(center);
        window.siyuan.layout.centerLayout = {element: center} as unknown as typeof window.siyuan.layout.centerLayout;
        const headersElement = center.querySelector<HTMLElement>("ul");
        const spacer = center.querySelector<HTMLElement>(".item--readonly .fn__flex-1");
        tabRows = [{element: center.querySelector("section"), headersElement}];
        const gapWidth = () => gap.getBoundingClientRect().width;
        try {
            tabUtil.setTabPosition();
            check.equal(gapWidth(), 0, `${platform} uses the free space beside the new tab button`);
            if (native) {
                const rect = spacer.getBoundingClientRect();
                await waitForPaint();
                check.deepEqual(await ipcRenderer.invoke("overlay-test-hit", [
                    {x: (rect.left + rect.right) / 2 / innerWidth, y: (rect.top + rect.bottom) / 2 / innerHeight},
                ]), [2], "the natural tab gap moves the native window");
            }
            const initialWidth = spacer.getBoundingClientRect().width;
            headersElement.style.width = `${100 + initialWidth - 20}px`;
            await waitForPaint();
            await waitForPaint();
            check.ok(Math.abs(gapWidth() - 24) < 0.1, `${platform} restores the fallback for crowded tabs`);
            const rect = gap.getBoundingClientRect();
            if (platform === "mac") {
                check.ok(rect.right <= document.getElementById("captionColor").getBoundingClientRect().left);
            } else {
                check.ok(rect.left >= document.getElementById("rightToolbarButton").getBoundingClientRect().right - 1);
            }
            if (native) {
                check.deepEqual(await ipcRenderer.invoke("overlay-test-hit", [
                    {x: (rect.left + rect.right) / 2 / innerWidth, y: (rect.top + rect.bottom) / 2 / innerHeight},
                ]), [2], "the fallback gap moves the native window");
            }
            // 兜底区仍在时，现有页签拖拽区几乎没有空间；重算时按去掉兜底区的 25px 判断。
            headersElement.style.width = `${100 + initialWidth - 25}px`;
            tabUtil.setTabPosition(true);
            check.equal(gapWidth(), 0, `${platform} reevaluates without subtracting the fallback itself`);
            for (let index = 0; index < 3; index++) {
                await waitForPaint();
                check.equal(gapWidth(), 0, `${platform} settles without switching back`);
            }
            center.style.top = "60px";
            tabUtil.setTabPosition(true);
            check.ok(Math.abs(gapWidth() - 24) < 0.1, "a lower split row is not a native title bar target");
            document.getElementById("drag").classList.add("fn__hidden");
            check.equal(gapWidth(), 0, "fullscreen hides the fallback");
            document.getElementById("drag").classList.remove("fn__hidden");
        } finally {
            center.remove();
            tabRows = [];
            tabUtil.setTabPosition(true);
        }
    };
    const checkPanelFullscreen = async (platform: "windows" | "linux" | "mac", native = false) => {
        document.body.className = `body--${platform} body--toolbar-hide`;
        window.siyuan.config.system.os = platform === "mac" ? "darwin" : platform;
        const gap = document.querySelector<HTMLElement>(".toolbar__window-gap");
        const gapRect = gap.getBoundingClientRect();
        check.ok(Math.abs(gapRect.width - 24) < 0.1, `${platform} shows the window drag region in the regular layout`);
        check.equal(getComputedStyle(gap).getPropertyValue("-webkit-app-region"), "drag");
        if (platform === "mac") {
            check.ok(gapRect.right <= document.getElementById("captionColor").getBoundingClientRect().left,
                "macOS keeps the window drag region to the left of the toolbar buttons");
        }
        const panel = document.createElement("section");
        panel.className = "sy__graph";
        panel.innerHTML = '<div class="block__icons" style="display:flex;justify-content:flex-end"><button type="button" style="width:32px;height:30px"><svg><use xlink:href="#iconFullscreen"/></svg></button></div>';
        document.body.append(panel);
        const button = panel.querySelector("button");
        button.addEventListener("click", () => panelFullscreen.fullscreen(panel, button));
        button.click();
        check.ok(panel.classList.contains("fullscreen"));
        check.ok(document.getElementById("drag").classList.contains("fn__hidden"));
        check.equal(gap.getBoundingClientRect().width, 0, `${platform} hides the drag region during panel fullscreen`);
        let testPoint: {x: number; y: number};
        if (native) {
            const buttonRect = button.getBoundingClientRect();
            const x = (buttonRect.left + buttonRect.right) / 2;
            const y = (buttonRect.top + buttonRect.bottom) / 2;
            check.ok(x > gapRect.left && x < gapRect.right && y > gapRect.top && y < gapRect.bottom,
                "the fullscreen toggle occupies the previous drag region");
            check.equal(document.elementFromPoint(x, y)?.closest("button"), button);
            testPoint = {x: x / innerWidth, y: y / innerHeight};
            await waitForPaint();
            check.deepEqual(await ipcRenderer.invoke("overlay-test-hit", [testPoint]), [1], "the fullscreen toggle receives clicks");
        }
        button.click();
        check.ok(!panel.classList.contains("fullscreen"));
        check.ok(Math.abs(gap.getBoundingClientRect().width - 24) < 0.1,
            `${platform} restores the drag region after panel fullscreen`);
        check.equal(getComputedStyle(gap).getPropertyValue("-webkit-app-region"), "drag");
        if (testPoint) {
            await waitForPaint();
            check.deepEqual(await ipcRenderer.invoke("overlay-test-hit", [testPoint]), [2], "the window can be dragged again");
        }
        document.body.classList.add("body--fullscreen");
        check.equal(gap.getBoundingClientRect().width, 0, `${platform} hides the drag region during window fullscreen`);
        document.body.classList.remove("body--fullscreen");
        panel.remove();
    };
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
        await checkPanelFullscreen("windows");
        await checkPanelFullscreen("linux");
        await checkPanelFullscreen("mac");
        await checkAdaptiveGap("windows");
        await checkAdaptiveGap("linux");
        await checkAdaptiveGap("mac");
        return "Window controls overlay cases passed";
    }
    const api = (navigator as Navigator & {windowControlsOverlay: import("./windowControlsOverlay").IWindowControlsOverlay}).windowControlsOverlay;
    Object.defineProperty(api, "visible", {value: false, configurable: true});
    try {
        controls.initWindowControls(container, () => { closed++; });
        check.equal(container.children.length, 0, "native windows never add self-drawn buttons while geometry is pending");
        check.ok(document.documentElement.classList.contains("window-controls-overlay--hidden"));
        check.equal(container.getBoundingClientRect().width, 0);
    } finally {
        Reflect.deleteProperty(api, "visible");
    }
    api.dispatchEvent(new Event("geometrychange"));
    for (let attempt = 0; attempt < 20 && container.getBoundingClientRect().width === 0; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    check.ok(container.getBoundingClientRect().width > 0, "late native geometry reserves the caption space");
    check.equal(container.children.length, 0);
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
            const gap = document.querySelector(".toolbar__window-gap");
            const gapRect = gap.getBoundingClientRect();
            check.ok(Math.abs(gapRect.width - (fused ? 24 : 0)) < 0.1,
                `${label} reserves the drag area only for fused tabs`);
            if (fused) {
                check.equal(getComputedStyle(gap).getPropertyValue("-webkit-app-region"), "drag");
                const buttonRight = document.getElementById("rightToolbarButton").getBoundingClientRect().right;
                check.ok(Math.abs(buttonRight - gapRect.left) < 3,
                    `${label} toolbar button ends at ${buttonRight}, drag area begins at ${gapRect.left}`);
                const controlsLeft = container.getBoundingClientRect().left;
                check.ok(Math.abs(controlsLeft - gapRect.right - 2) < 1,
                    `${label} drag area ends at ${gapRect.right}, controls begin at ${controlsLeft}`);
            }
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
    await checkPanelFullscreen("windows", true);
    await checkAdaptiveGap("windows", true);
    const wide = document.createElement("div");
    wide.style.cssText = "width:2000px;flex-shrink:0";
    document.getElementById("toolbar").prepend(wide);
    overlay.updateWindowControlsOverlay();
    check.ok(resizeCalls > 0, "overflow uses the existing toolbar folding logic");
    wide.remove();
    return "Window controls overlay cases passed";
};

test("window captions, fused tab drag regions and tooltips keep their own hit areas", {
    skip: process.platform !== "win32", timeout: 90000,
}, async () => {
    const sources = ["src/boot/windowControlsOverlay.ts", "src/boot/windowControls.ts", "src/dialog/tooltip.ts",
        "src/util/color.ts", "src/protyle/breadcrumb/action.ts", "src/layout/tabUtil.ts"].map(file =>
        transpileModule(readFileSync(file, "utf8"), {compilerOptions: {
            module: ModuleKind.CommonJS, target: ScriptTarget.ES2021,
        }}).outputText);
    const css = ["main/_main.scss", "util/_reset.scss", "component/_tooltips.scss"]
        .map(file => compile("src/assets/scss/" + file).css).join("\n");
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-window-controls-overlay-"));
    const script = path.join(temporary, "run.cjs");
    const html = path.join(temporary, "index.html");
    const hitTestScript = path.resolve("tests/fixtures/windowHitTest.ps1");
    const hitTestAssembly = path.join(temporary, "WindowHitTest.dll");
    // 主进程模块是 TypeScript，Electron 子进程无法直接 require，先转译到同一临时目录再加载。
    const overlayModule = path.join(temporary, "windowControlsOverlay.cjs");
    writeFileSync(overlayModule, transpileModule(readFileSync("electron/window/windowControlsOverlay.ts", "utf8"),
        {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText, "utf8");
    writeFileSync(html, "<!doctype html><html><head></head><body></body></html>", "utf8");
    writeFileSync(script, `const {app,BrowserWindow,ipcMain}=require("electron");
 const {promisify}=require("node:util"),execFile=promisify(require("node:child_process").execFile);
 const {updateTitleBarOverlay,withWindowControlsOverlay}=require(${JSON.stringify(overlayModule)});
app.setPath("userData",${JSON.stringify(path.join(temporary, "profile"))});
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:800,height:600,frame:false,titleBarStyle:"hidden",
  ...withWindowControlsOverlay({color:"#00000000"},{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false})});
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
 ipcMain.handle("overlay-test-hit",async(_event,points)=>{
  const buffer=win.getNativeWindowHandle();
  const handle=buffer.length===8?buffer.readBigUInt64LE().toString():String(buffer.readUInt32LE());
  const {stdout}=await execFile("powershell.exe",["-NoProfile","-NonInteractive","-File",${JSON.stringify(hitTestScript)},
   handle,JSON.stringify(points),"-AssemblyPath",${JSON.stringify(hitTestAssembly)}],{windowsHide:true,timeout:10000});
  return JSON.parse(stdout);
 });
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
        await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", hitTestScript,
            "-Prepare", "-AssemblyPath", hitTestAssembly], {windowsHide: true, timeout: 45000});
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 55000, windowsHide: true});
        assert.match(result.stdout, /Window controls overlay cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-window-controls-overlay-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
