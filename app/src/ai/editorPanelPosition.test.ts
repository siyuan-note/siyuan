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
