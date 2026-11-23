import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {compileString} from "sass";
import {browserSources, runBrowserCase} from "../datePicker/test/browser";

test("AI edit follows the source until moved and keeps the mobile bottom bar accessible", async () => {
    const sources = browserSources({position: "src/ai/editorPanelPosition.ts"});
    const css = compileString(readFileSync("src/assets/scss/business/_ai_editor.scss", "utf8")).css;
    const result = await runBrowserCase(async (modules, sheet) => {
        const mod = {exports: {} as typeof import("./editorPanelPosition")};
        new Function("exports", modules.position)(mod.exports);
        const style = document.createElement("style");
        style.textContent = sheet + " #host {position:relative; width:700px;height:430px;--mobile-bottom-bar-offset:48px} #anchor{position:absolute;left:50px;top:70px}";
        document.head.appendChild(style);
        document.body.innerHTML = '<div id="host"><div id="anchor">source</div><div class="ai-editor-panel">' +
            '<div class="ai-editor-panel__grip"></div><div class="ai-editor-panel__header">title</div>' +
            '<div class="ai-editor-panel__body protyle-wysiwyg">result</div><div class="ai-editor-panel__actions">insert</div></div></div>';
        const host = document.getElementById("host");
        const anchor = document.getElementById("anchor");
        const panel = host.querySelector<HTMLElement>(".ai-editor-panel");
        const header = panel.querySelector<HTMLElement>(".ai-editor-panel__header");
        const grip = panel.querySelector<HTMLElement>(".ai-editor-panel__grip");
        const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
        const drag = (handle: HTMLElement, dx: number, dy: number) => {
            handle.setPointerCapture = () => {};
            for (const [type, x, y] of [["pointerdown", 0, 0], ["pointermove", dx, dy], ["lostpointercapture", dx, dy]] as const) {
                handle.dispatchEvent(new PointerEvent(type, {pointerId: 1, button: 0, clientX: x, clientY: y}));
            }
        };
        const desktop = mod.exports.bindEditorPanelPosition(host, host, panel, false, () => anchor);
        check(panel.offsetLeft === anchor.offsetLeft, "initial anchor");
        drag(header, 40, 25);
        const x = panel.offsetLeft;
        const y = panel.offsetTop;
        check(x === anchor.offsetLeft + 40, "drag moves panel");
        anchor.style.top = "0";
        panel.querySelector<HTMLElement>(".ai-editor-panel__body").style.height = "110px";
        host.dispatchEvent(new Event("scroll"));
        check(panel.offsetLeft === x && panel.offsetTop === y, "scroll and growth preserve manual position");
        host.style.width = "400px";
        desktop.update();
        check(panel.offsetLeft + panel.offsetWidth <= host.clientWidth, "clamp after resize");
        host.style.width = "700px";
        header.dispatchEvent(new MouseEvent("dblclick"));
        check(panel.offsetLeft === anchor.offsetLeft && panel.offsetTop < y, "restore anchor");
        desktop.destroy();
        panel.classList.add("ai-editor-panel--mobile");
        const mobile = mod.exports.bindEditorPanelPosition(host, host, panel, true, () => anchor);
        const initial = panel.offsetHeight;
        const bottom = panel.getBoundingClientRect().bottom;
        drag(grip, 0, -60);
        check(panel.offsetHeight === initial + 60, "mobile grip resizes drawer");
        check(panel.getBoundingClientRect().bottom === bottom && host.getBoundingClientRect().bottom - bottom >= 48, "preserve bottom bar");
        drag(grip, 0, -1000);
        check(panel.getBoundingClientRect().top >= host.getBoundingClientRect().top, "clamp drawer");
        grip.dispatchEvent(new KeyboardEvent("keydown", {key: "Home"}));
        check(panel.offsetHeight === initial, "restore mobile height");
        mobile.destroy();
        return "passed";
    }, sources, css, {width: 800, height: 540});
    assert.match(result, /passed/);
});

test("desktop AI edit resizes past the initial height limit and restores the anchored size", async () => {
    const sources = browserSources({position: "src/ai/editorPanelPosition.ts"});
    const css = compileString(readFileSync("src/assets/scss/business/_ai_editor.scss", "utf8")).css;
    const result = await runBrowserCase(async (modules, sheet) => {
        const mod = {exports: {} as typeof import("./editorPanelPosition")};
        new Function("exports", modules.position)(mod.exports);
        const style = document.createElement("style");
        style.textContent = sheet + "main{width:800px;height:500px;position:relative}.ai-editor-panel__body{height:600px}";
        document.head.appendChild(style);
        document.body.innerHTML = '<main><p>source</p><div class="ai-editor-panel"><header class="ai-editor-panel__header">Title</header>' +
            '<div class="ai-editor-panel__body protyle-wysiwyg">result</div><footer class="ai-editor-panel__actions">insert</footer></div></main>';
        const host = document.querySelector("main");
        mod.exports.bindEditorPanelPosition(host, host, host.querySelector(".ai-editor-panel"), false, () => host.querySelector("p"));
        return "ready";
    }, sources, css, {width: 900, height: 620, interact: async win => {
        const web = win.webContents;
        const rect = () => web.executeJavaScript('document.querySelector(".ai-editor-panel").getBoundingClientRect().toJSON()');
        const dragCorner = async (dx: number, dy: number) => {
            const start = await rect();
            const x = start.right - 4, y = start.bottom - 4;
            for (const [type, offsetX, offsetY] of [["mousePressed", 0, 0], ["mouseMoved", dx, dy], ["mouseReleased", dx, dy]] as const) {
                await web.debugger.sendCommand("Input.dispatchMouseEvent", {type, x: x + offsetX, y: y + offsetY,
                    button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1});
            }
            await web.executeJavaScript("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))");
        };
        const start = await rect();
        await dragCorner(0, 40);
        const taller = await rect();
        await dragCorner(60, 0);
        const wider = await rect();
        if (taller.height < start.height + 35 || wider.width < start.width + 55) throw Error("Native resize did not grow the panel");
        await web.executeJavaScript('document.querySelector("header").dispatchEvent(new MouseEvent("dblclick"))');
        const restored = await rect();
        if (restored.height !== start.height || restored.width !== start.width) throw Error("Default size was not restored");
        return "resized";
    }});
    assert.match(result, /resized/);
});
