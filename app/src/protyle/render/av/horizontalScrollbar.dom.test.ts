import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const exerciseScrollbar = async (sourceCode: string) => {
    const check: typeof assert = require("node:assert/strict");
    const {ipcRenderer} = require("electron") as typeof import("electron");
    const api: typeof import("./horizontalScrollbar") = new Function("exports", sourceCode + "\nreturn exports;")({});
    Object.defineProperty(window, "siyuan", {value: {languages: {scrollHorizontal: "Horizontal scrolling"}}});
    document.body.style.cssText = "display:flex;gap:15px;margin:0;--b3-theme-surface:#eee;--b3-theme-on-surface-light:#666;--b3-theme-primary:#2563eb";
    const createEditor = (scrollColor: string) => {
        const element = document.createElement("div");
        element.className = "protyle";
        element.tabIndex = -1;
        element.style.cssText = "width:300px;height:250px";
        element.style.setProperty("--b3-scroll-color", scrollColor);
        element.innerHTML = '<div class="protyle-content" style="overflow:auto;flex:1"><div class="protyle-wysiwyg" style="padding:0"></div></div>';
        document.body.append(element);
        const contentElement = element.firstElementChild as HTMLElement;
        const wysiwyg = {element: contentElement.firstElementChild as HTMLElement};
        const protyle = {element, contentElement, wysiwyg};
        contentElement.addEventListener("scroll", () => api.scheduleAVHorizontalScrollbar(protyle));
        const addTable = (width: number, height: number) => {
            const block = document.createElement("div");
            block.className = "av";
            block.dataset.avType = "table";
            block.innerHTML = `<div class="av__container" style="width:100%;min-width:0">
                <div class="av__scroll"><div class="av__body" style="width:${width}px;height:${height}px"></div></div></div>`;
            wysiwyg.element.append(block);
            api.registerAVHorizontalScrollbar(protyle, block);
            return {block, source: block.querySelector<HTMLElement>(".av__scroll"),
                body: block.querySelector<HTMLElement>(".av__body")};
        };
        return {protyle, addTable, scroller: contentElement,
            track: () => element.querySelector<HTMLElement>(".av__horizontal-scrollbar")};
    };
    const settle = () => new Promise<void>(resolve => requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const until = async (condition: () => boolean, message: string) => {
        const deadline = performance.now() + 1500;
        while (!condition() && performance.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        check.ok(condition(), message);
    };
    const left = createEditor("rgb(187, 187, 187)");
    const right = createEditor("rgb(85, 85, 85)");
    const first = left.addTable(900, 950);
    const second = left.addTable(1100, 800);
    const other = right.addTable(850, 800);
    const track = left.track();
    const displayed = (element: HTMLElement) => element.getBoundingClientRect().height !== 0;
    await until(() => displayed(track) && displayed(right.track()), "both viewports show their own scrollbar");
    for (const [proxy, source] of [
        [track, first.source],
        [right.track(), other.source],
    ] as const) {
        const sourceScrollbar = getComputedStyle(source, "::-webkit-scrollbar");
        check.equal(getComputedStyle(proxy, "::-webkit-scrollbar").height, sourceScrollbar.height);
        check.equal(getComputedStyle(proxy).height, sourceScrollbar.height);
        const sourceStyle = getComputedStyle(source);
        check.equal(getComputedStyle(proxy).backgroundColor, sourceStyle.backgroundColor);
        const proxyThumb = getComputedStyle(proxy, "::-webkit-scrollbar-thumb");
        const sourceThumb = getComputedStyle(source, "::-webkit-scrollbar-thumb");
        check.equal(proxyThumb.borderTopWidth, sourceThumb.borderTopWidth);
        check.equal(proxyThumb.backgroundColor, sourceThumb.backgroundColor);
        check.equal(proxyThumb.boxShadow, sourceThumb.boxShadow);
        check.ok(proxyThumb.boxShadow.includes(sourceStyle.getPropertyValue("--b3-scroll-color")),
            "the thumb uses the current theme's scrollbar color");
    }
    check.equal(left.protyle.wysiwyg.element.contains(track), false);
    check.equal(Math.round(track.getBoundingClientRect().bottom), Math.round(left.scroller.getBoundingClientRect().bottom));
    check.equal(track.scrollWidth - track.clientWidth, first.source.scrollWidth - first.source.clientWidth);

    const bounds = track.getBoundingClientRect();
    await ipcRenderer.invoke("drag-thumb", bounds.left + 12, bounds.bottom - 5, bounds.width * .56);
    await settle();
    check.ok(first.source.scrollLeft > (first.source.scrollWidth - first.source.clientWidth) / 2,
        "native thumb drag scrolls the table: " + JSON.stringify({source: first.source.scrollLeft, proxy: track.scrollLeft,
            hit: document.elementFromPoint(bounds.left + 12, bounds.bottom - 5)?.className,
            rect: bounds.toJSON(), clientHeight: track.clientHeight}));
    check.equal(track.scrollLeft, first.source.scrollLeft);
    check.equal(other.source.scrollLeft, 0);
    check.equal(getComputedStyle(track).outlineStyle, "none", "mouse dragging does not draw a focus outline");
    first.source.scrollLeft = 100;
    await settle();
    check.equal(track.scrollLeft, 100);

    left.scroller.scrollTop = first.block.offsetTop + first.block.offsetHeight - left.scroller.clientHeight + 5;
    await settle();
    check.equal(displayed(track), false, "the source scrollbar is in view");
    left.scroller.scrollTop = second.block.offsetTop + 20;
    await settle();
    check.ok(displayed(track));
    check.equal(track.scrollLeft, 0, "the next table starts at its own horizontal offset");

    const fixedFooter = document.createElement("div");
    fixedFooter.className = "av__row--footer--fixed";
    fixedFooter.style.cssText = "position:fixed;top:220px;height:30px";
    second.body.append(fixedFooter);
    api.scheduleAVHorizontalScrollbar(left.protyle);
    await settle();
    check.equal(Math.round(track.getBoundingClientRect().bottom), 220);

    const beforeTrack = document.createElement("button");
    track.before(beforeTrack);
    beforeTrack.focus({preventScroll: true});
    await ipcRenderer.invoke("scroll-key", "Tab", 9);
    check.equal(document.activeElement, track);
    check.equal(getComputedStyle(track).outlineStyle, "auto", "Tab uses the browser's visible focus indicator");
    await ipcRenderer.invoke("scroll-key", "End", 35);
    await settle();
    check.equal(second.source.scrollLeft, second.source.scrollWidth - second.source.clientWidth);
    await ipcRenderer.invoke("scroll-key", "Home", 36);
    await settle();
    check.equal(second.source.scrollLeft, 0);
    second.body.style.width = "100px";
    await settle();
    check.equal(displayed(track), false);
    check.equal(document.activeElement, left.protyle.element);
    second.body.style.width = "1000px";
    await settle();
    check.ok(displayed(track));
    second.block.dataset.avType = "gallery";
    second.source.replaceWith(document.createElement("div"));
    await settle();
    check.equal(displayed(track), false);
    api.destroyAVHorizontalScrollbar(left.protyle);
    check.equal(left.track(), null);
    check.ok(displayed(right.track()));
    api.destroyAVHorizontalScrollbar(right.protyle);
    return "Database scrollbar passed";
};

const headless = process.env.SIYUAN_TEST_HEADLESS === "1";
test("a native scrollbar drags and follows the visible database independently in each editor", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !headless,
    timeout: 60000,
}, async () => {
    const directory = mkdtempSync(join(tmpdir(), "siyuan-av-scrollbar-"));
    try {
        const profile = join(directory, "profile");
        const session = join(directory, "session");
        mkdirSync(profile);
        mkdirSync(session);
        const source = transpileModule(readFileSync("src/protyle/render/av/horizontalScrollbar.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText;
        const css = compile("src/assets/scss/base.scss", {logger: {warn() {}}}).css;
        const code = transpileModule(`const __name = value => value; (${exerciseScrollbar.toString()})(${JSON.stringify(source)})`, {
            compilerOptions: {target: ScriptTarget.ES2022},
        }).outputText;
        const script = join(directory, "main.cjs");
        writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(profile)});
app.setPath("sessionData", ${JSON.stringify(session)});
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:700, height:500, webPreferences:{nodeIntegration:true, contextIsolation:false, offscreen:true}});
    try {
        await win.loadURL("about:blank");
        await win.webContents.insertCSS(${JSON.stringify(css)});
        win.webContents.debugger.attach("1.3");
        ipcMain.handle("drag-thumb", async (_event, x, y, distance) => {
            const send = (type, at, buttons) => win.webContents.debugger.sendCommand("Input.dispatchMouseEvent",
                {type, x:at, y, button:buttons || type === "mouseReleased" ? "left" : "none", buttons, clickCount:1});
            await send("mouseMoved", x, 0);
            await send("mousePressed", x, 1);
            for (let step = 1; step <= 4; step++) await send("mouseMoved", x + distance * step / 4, 1);
            await send("mouseReleased", x + distance, 0);
        });
        ipcMain.handle("scroll-key", async (_event, key, windowsVirtualKeyCode) => {
            for (const type of ["keyDown", "keyUp"]) {
                await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {type, key, code:key, windowsVirtualKeyCode});
            }
        });
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));
        win.destroy();
        app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});`, "utf8");
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        const args = [...(headless ? ["--ozone-platform=headless", "--disable-gpu"] : []), script];
        const result = await promisify(execFile)(require("electron") as unknown as string, args, {env, timeout: 30000});
        assert.match(result.stdout, /Database scrollbar passed/);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
