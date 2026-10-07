import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compileString} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = (sources: string[], css: string) => {
    const check: typeof assert = require("node:assert/strict");
    const core = {};
    new Function("exports", sources[1])(core);
    const bridge = {} as {initTouchDragBridge: () => void};
    new Function("exports", "require", sources[0])(bridge, (id: string) => id === "./touchDragBridgeCore" ? core : {
        Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 500, TIMEOUT_MOUSE_DRAG_DELAY: 150},
        isInAndroid: () => false, ipcRenderer: {on() {}}, stopScrollAnimation() {},
    });
    const resize = {} as {moveResize: (element: HTMLElement) => void};
    new Function("exports", "require", sources[2])(resize, () => ({
        hasClosestByClassName: (element: Element, name: string) => element.closest("." + name),
        getTopBarHeight: () => 0, hideAllElements() {},
    }));
    window.siyuan = {touchDragActive: false} as typeof window.siyuan;
    bridge.initTouchDragBridge();
    check.equal(matchMedia("(any-pointer: coarse)").matches, true, "the reported media-query state is reproduced");
    document.body.innerHTML = `<style>${css}
body {margin:0}.b3-dialog {position:fixed;inset:0}.b3-dialog__scrim {position:absolute;inset:0}
.b3-dialog__container {position:absolute;left:100px;top:100px;width:300px;height:200px;background:white;border:1px solid #ddd;box-sizing:border-box}
.content {height:100%;overflow:auto}button {position:absolute;right:12px;top:12px}
</style><div class="b3-dialog"><div class="b3-dialog__scrim"></div><div class="b3-dialog__container">
<div class="content">Content</div><button>Close</button>
${["rd", "ld", "lt", "rt", "r", "d", "t", "l"].map(dir => `<div class="resize__${dir}"></div>`).join("")}
</div></div>`;
    const container = document.querySelector<HTMLElement>(".b3-dialog__container");
    const scrim = document.querySelector<HTMLElement>(".b3-dialog__scrim");
    const right = container.querySelector<HTMLElement>(".resize__r");
    const corner = container.querySelector<HTMLElement>(".resize__rd");
    resize.moveResize(container);
    const pointer = (type: string, pointerType: string, target: Element = scrim) => {
        target.dispatchEvent(new PointerEvent(type, {bubbles: true, pointerType, pointerId: 1, button: 0}));
    };
    const touch = (type: string, target: Element, x: number, y: number, radius = 1) => {
        const point = new Touch({identifier: 1, target, clientX: x, clientY: y, radiusX: radius, radiusY: radius});
        const event = new TouchEvent(type, {bubbles: true, cancelable: true,
            touches: type === "touchend" ? [] : [point], changedTouches: [point]});
        target.dispatchEvent(event);
        return event;
    };
    const mouseHits = () => {
        check.equal(right.getBoundingClientRect().width, 4);
        check.equal(corner.getBoundingClientRect().width, 8);
        check.equal(document.elementFromPoint(410, 180), scrim);
        check.equal(document.elementFromPoint(400, 180), right);
        check.equal(document.elementFromPoint(250, 95), scrim);
        check.equal(document.elementFromPoint(250, 99).className, "resize__t");
        check.equal(document.elementFromPoint(94, 94), scrim);
        check.equal(document.elementFromPoint(99, 99).className, "resize__lt");
    };
    pointer("pointermove", "mouse");
    mouseHits();
    const firstTouchTarget = document.elementFromPoint(410, 180);
    const initialWidth = container.clientWidth;
    check.equal(firstTouchTarget, scrim);
    pointer("pointerdown", "touch", firstTouchTarget);
    touch("touchstart", firstTouchTarget, 410, 180);
    check.equal(right.getBoundingClientRect().width, 14);
    check.equal(corner.getBoundingClientRect().width, 24);
    check.equal(right.classList.contains("touch-resize-active"), true, "the first touch on the expanded edge starts resizing");
    check.equal(touch("touchmove", firstTouchTarget, 440, 180).defaultPrevented, true);
    check.equal(container.getBoundingClientRect().width, initialWidth + 30);
    touch("touchend", firstTouchTarget, 440, 180);
    check.equal(document.onmousemove, null);
    check.equal(right.classList.contains("touch-resize-active"), false);
    container.style.width = "300px";
    pointer("pointerover", "mouse");
    mouseHits();
    pointer("pointerdown", "pen");
    check.equal(right.getBoundingClientRect().width, 14);
    pointer("pointermove", "mouse");
    mouseHits();
    pointer("pointerdown", "mouse");
    touch("touchstart", scrim, 410, 180, 0);
    check.equal(right.getBoundingClientRect().width, 4, "mouse-generated touches retain the narrow edge");
    check.equal(document.onmousemove, null);
    touch("touchend", scrim, 410, 180, 0);
    touch("touchstart", scrim, 410, 180);
    check.equal(right.classList.contains("touch-resize-active"), true, "real contact overrides the previous mouse input");
    touch("touchend", scrim, 410, 180);
    pointer("pointermove", "mouse");
    const button = container.querySelector("button");
    touch("touchstart", button, 370, 125);
    check.equal(document.onmousemove, null, "touching dialog controls does not start resizing");
    touch("touchend", button, 370, 125);
    touch("touchstart", scrim, 450, 180);
    check.equal(document.onmousemove, null, "touches beyond the expanded edge remain on the scrim");
    touch("touchend", scrim, 450, 180);
    pointer("pointermove", "mouse");
    mouseHits();
    return "Dialog resize input cases passed";
};

test("dialog resize hit areas follow actual input even when coarse media matches", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const sources = ["src/util/touchDragBridge.ts", "src/util/touchDragBridgeCore.ts", "src/dialog/moveResize.ts"]
        .map(file => transpileModule(readFileSync(file, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText);
    const css = compileString(readFileSync("src/assets/scss/business/_resize.scss", "utf8")).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-dialog-resize-input-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 800, height: 600,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled: true});
        const result = await win.webContents.executeJavaScript(${JSON.stringify("const __name = value => value; try { (" +
            browserCases.toString() + ")(" + JSON.stringify(sources) + "," + JSON.stringify(css) + "); } catch (error) { error.stack; }")});
        console.log(result);
        if (result !== "Dialog resize input cases passed") {
            throw new Error(result);
        }
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        win.destroy();
        app.exit(1);
    }
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 25000, windowsHide: true});
        assert.match(result.stdout, /Dialog resize input cases passed/);
    } finally {
        if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
            path.basename(temporary).startsWith("siyuan-dialog-resize-input-test-")) {
            rmSync(temporary, {recursive: true, force: true});
        }
    }
});
