import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile, Logger} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, topBarSource: string, css: string, theme: string, withBridge: boolean) => {
    const check: typeof assert = require("node:assert/strict");
    const exports: typeof import("./harmonyWindowControls") = {} as typeof import("./harmonyWindowControls");
    new Function("exports", source)(exports);
    const topBar: Pick<typeof import("../layout/util"), "resizeTopBar"> = {} as Pick<typeof import("../layout/util"), "resizeTopBar">;
    new Function("exports", "Constants", topBarSource)(topBar, {MENU_BAR_MAIN_MENU: "barMain"});
    const style = document.createElement("style");
    style.textContent = theme + css;
    document.head.append(style);
    document.body.className = "body--harmony";
    document.body.innerHTML = `<div id="toolbar" class="toolbar toolbar--browser fn__flex">
    <button class="toolbar__item" id="barMain">Menu</button><div class="fn__flex-1" id="drag"></div>
    ${Array.from({length: 5}, (_, index) => `<button class="toolbar__item" id="extra-${index}">Extra</button>`).join("")}
    <button class="toolbar__item" id="visibleControl">Search</button><button class="toolbar__item" id="barMore">...</button>
    <div class="toolbar__window-gap"></div><div id="windowControls"></div></div>
    <div id="dockLeft"></div><div class="layout-tab-row--harmony-controls"></div>`;
    const toolbar = document.getElementById("toolbar");
    const control = document.getElementById("visibleControl");
    const root = document.documentElement;
    const gap = toolbar.querySelector<HTMLElement>(".toolbar__window-gap");
    const geometry = {windowWidth: innerWidth * 2, rightInset: 280, bottom: 100, movable: true};
    let dragArea: number[] = [];
    if (withBridge) {
        window.SiYuanHarmonyWindowControls = {
            connect: () => JSON.stringify(geometry),
            setDragArea: (...area: number[]) => { dragArea = area; },
        };
        window.siyuan = {config: {appearance: {hideToolbar: false}}} as typeof window.siyuan;
        window.addEventListener("resize", topBar.resizeTopBar);
    }
    const waitForLayout = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const publish = (detail: unknown) => window.dispatchEvent(new CustomEvent("siyuan-harmony-window-controls", {detail}));
    exports.initHarmonyWindowControls();
    if (!withBridge) {
        check.equal(root.hasAttribute("data-harmony-window-controls"), false);
        check.equal(gap.clientWidth, 0);
        return;
    }
    await waitForLayout();
    check.equal(root.getAttribute("data-harmony-window-controls"), "movable");
    check.equal(toolbar.clientHeight, 50);
    check.ok(control.getBoundingClientRect().right < innerWidth - 140);
    check.equal(gap.clientWidth, 24);
    check.equal(dragArea[2], gap.getBoundingClientRect().right * 2);
    check.ok(dragArea[2] <= geometry.windowWidth - geometry.rightInset);
    if (innerWidth < 500) {
        check.equal(toolbar.querySelector<HTMLElement>("#barMore").classList.contains("fn__none"), false);
        check.ok(toolbar.querySelectorAll('[data-hide="true"]').length > 0);
        check.ok(toolbar.scrollWidth <= toolbar.clientWidth + 2);
    }

    document.body.classList.add("body--toolbar-hide");
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {position: "fixed", inset: "0", zIndex: "100"});
    document.body.append(overlay);
    await waitForLayout();
    check.deepEqual(dragArea, [0, 0, 0, 0]);
    check.equal(document.querySelector(".layout-tab-row--harmony-controls").clientHeight, 50);
    check.equal(getComputedStyle(document.getElementById("dockLeft")).marginTop, "50px");
    overlay.remove();

    publish({...geometry, rightInset: 300, bottom: 84, movable: false});
    await waitForLayout();
    check.equal(root.getAttribute("data-harmony-window-controls"), "visible");
    check.equal(gap.clientWidth, 0);
    check.ok(control.getBoundingClientRect().right < innerWidth - 150);
    check.deepEqual(dragArea, [0, 0, 0, 0]);

    publish(null);
    await waitForLayout();
    check.equal(root.hasAttribute("data-harmony-window-controls"), false);
    check.equal(root.style.getPropertyValue("--harmony-window-controls-inset"), "");
};

test("Harmony desktop shares a row with native buttons and excludes the drag gap when covered", {timeout: 45000}, async () => {
    const compileTypeScript = (text: string) => transpileModule(text, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const source = compileTypeScript(readFileSync(join(__dirname, "harmonyWindowControls.ts"), "utf8"));
    const topBarText = readFileSync(join(__dirname, "../layout/util.ts"), "utf8")
        .match(/^export const resizeTopBar = .*?^};/ms)?.[0];
    assert.ok(topBarText);
    const topBarSource = compileTypeScript(topBarText);
    const css = compile(join(__dirname, "../assets/scss/base.scss"), {logger: Logger.silent}).css;
    const themes = ["daylight", "midnight"].map(theme =>
        readFileSync(join(__dirname, `../../appearance/themes/${theme}/theme.css`), "utf8"));
    const directory = mkdtempSync(join(tmpdir(), "siyuan-harmony-window-controls-"));
    const script = join(directory, "run.cjs");
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData",${JSON.stringify(join(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
const run=(win,theme,bridge)=>win.webContents.executeJavaScript(
    "(()=>{const __name=value=>value;return ("+${JSON.stringify(browserCases.toString())}+")("+
    [${JSON.stringify(source)},${JSON.stringify(topBarSource)},${JSON.stringify(css)},theme,bridge].map(value=>JSON.stringify(value)).join(",")+");})()"
);
app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:960,height:680,useContentSize:true,
        webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true,backgroundThrottling:false}});
    try {
        await win.loadURL("about:blank");
        await run(win,${JSON.stringify(themes[0])},false);
        for(const [width,theme] of [[900,${JSON.stringify(themes[0])}],[360,${JSON.stringify(themes[1])}]]) {
            win.setContentSize(width,640);
            await win.loadURL("about:blank");
            await run(win,theme,true);
        }
        console.log("Harmony window controls cases passed");
        app.exit(0);
    } catch(error){console.error(error);app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const args = process.env.SIYUAN_ELECTRON_HEADLESS === "1" ?
            ["--ozone-platform=headless", "--ozone-override-screen-size=1920,1080", script] : [script];
        const result = await promisify(execFile)(require("electron") as unknown as string, args, {env, windowsHide: true, timeout: 40000});
        assert.match(result.stdout, /Harmony window controls cases passed/);
    } finally {
        assert.equal(resolve(directory, ".."), resolve(tmpdir()));
        assert.ok(directory.startsWith(join(tmpdir(), "siyuan-harmony-window-controls-")));
        rmSync(directory, {recursive: true, force: true});
    }
});
