import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compileString} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import type {App} from "../index";

const {parse} = require("ifdef-loader/preprocessor");

const browserCases = (sources: string[], css: string, mobile: boolean) => {
    const check: typeof assert = require("node:assert/strict");
    const core = {};
    new Function("exports", sources[1])(core);
    const bridge = {} as typeof import("../util/touchDragBridge");
    new Function("exports", "require", sources[0])(bridge, (id: string) => id === "./touchDragBridgeCore" ? core : {
        Constants: {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 500},
        isInAndroid: () => false, isInHarmony: () => false, ipcRenderer: {on() {}}, stopScrollAnimation() {},
    });
    const resize = {} as typeof import("../dialog/moveResize");
    const closest = (element: Element, name: string) => element?.closest("." + name);
    const dependencies = {hasClosestByClassName: closest, getTopBarHeight: () => 32, hideAllElements() {}};
    new Function("exports", "require", sources[2])(resize, () => dependencies);
    let sequence = 0;
    const panels = {} as typeof import("./Panel");
    new Function("exports", "require", sources[3])(panels, (id: string) => id === "../dialog/moveResize" ? resize : {
        ...dependencies,
        genUUID: () => String(++sequence), registerBlockPanelOwner() {}, updateHotkeyAfterTip: () => "",
        setPosition: (element: HTMLElement, x: number, y: number) => {
            element.style.left = x + "px";
            element.style.top = y + "px";
        },
    });
    // 保留实际浮窗构造、标记、事件和固定回调，仅替换编辑器的数据加载。
    Object.defineProperty(panels.BlockPanel.prototype, "initProtyle", {
        value: (element: HTMLElement, after?: () => void) => {
            element.innerHTML = '<div contenteditable="true">Editable block content</div>';
            after?.();
        },
    });
    window.siyuan = {blockPanels: [], zIndex: 0, touchDragActive: false, languages: {pin: "Pin", unpin: "Unpin"},
        config: {keymap: {general: {closeTab: {custom: ""}}, editor: {general: {openInNewTab: {custom: ""}}}}},
        menus: {menu: {element: document.createElement("div")}},
    } as unknown as typeof window.siyuan;
    const style = document.createElement("style");
    style.textContent = css + `
body {margin:0;background:white} .block__popover {transition:none;background:white}
.resize__move {flex:1} .block__content {min-height:0} .block__edit {min-height:600px}
.underlay {position:absolute;inset:0}
`;
    document.head.append(style);
    document.body.innerHTML = '<div class="underlay" contenteditable="true">Background editor</div>';
    bridge.initTouchDragBridge();
    let panel: InstanceType<typeof panels.BlockPanel>;
    const createPanel = () => {
        panel?.destroy();
        panel = new panels.BlockPanel({app: {} as App, refDefs: [{refID: "reference"}], isBacklink: false, x: 100, y: 100});
        window.siyuan.blockPanels.push(panel);
        Object.assign(panel.element.style, {width: "300px", height: "240px", borderWidth: "0"});
        return panel.element;
    };
    const touch = (type: string, target: Element, x: number, y: number, count = 1) => {
        const point = new Touch({identifier: 1, target, clientX: x, clientY: y, radiusX: 1, radiusY: 1});
        const event = new TouchEvent(type, {bubbles: true, cancelable: true,
            touches: type === "touchend" || type === "touchcancel" ? [] :
                Array.from({length: count}, (_, index) => new Touch({...point, identifier: index + 1, target,
                    clientX: x, clientY: y, radiusX: 1, radiusY: 1})), changedTouches: [point]});
        target.dispatchEvent(event);
        return event;
    };
    const pointer = (type: string, pointerType = "mouse") => document.body.dispatchEvent(
        new PointerEvent(type, {bubbles: true, pointerType, pointerId: 1}),
    );
    const center = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
    };
    const clean = () => {
        check.equal(document.onmousemove, null);
        check.equal(document.onmouseup, null);
        check.equal(document.ondragstart, null);
        check.equal(window.siyuan.touchDragActive, false);
        check.equal(document.querySelector(".touch-resize-active, [data-touch-resize-corner]"), null);
    };
    const directions = ["move", "r", "l", "t", "d", "rd", "ld", "rt", "lt"];
    for (const direction of directions) {
        const element = createPanel();
        const handle = element.querySelector<HTMLElement>(".resize__" + direction);
        const point = center(handle);
        const x = direction.includes("l") ? 100 : point.x;
        const y = direction.includes("t") ? 100 : point.y;
        const dx = direction.includes("l") ? -40 : 40;
        const dy = direction.includes("t") ? -30 : 30;
        touch("touchstart", handle, x, y);
        check.equal(typeof document.onmousemove, mobile ? "object" : "function", direction);
        if (!mobile) {
            check.equal(element.querySelector(".resize__r").getBoundingClientRect().width, 14);
            check.equal(element.querySelector(".resize__rd").getBoundingClientRect().width, 24);
            if (direction.length === 2) {
                check.equal(element.querySelectorAll("[data-touch-resize-corner]").length, 2);
            }
        }
        check.equal(touch("touchmove", handle, x + dx, y + dy).defaultPrevented, !mobile, direction);
        touch("touchend", handle, x + dx, y + dy);
        if (!mobile) {
            check.equal(element.dataset.pin, "true", direction + " pins the actual panel");
            check.equal(element.querySelector('[data-type="pin"] use').getAttribute("xlink:href"), "#iconUnpin");
            check.equal(parseFloat(element.style.left), direction === "move" ? 140 : direction.includes("l") ? 60 : 100);
            check.equal(parseFloat(element.style.top), direction === "move" ? 130 : direction.includes("t") ? 70 : 100);
            check.equal(parseFloat(element.style.width), direction !== "move" && /[rl]/.test(direction) ? 340 : 300);
            check.equal(parseFloat(element.style.height), direction !== "move" && /[td]/.test(direction) ? 270 : 240);
        } else {
            check.equal(element.dataset.pin, "false");
            check.equal(element.style.left, "100px");
            check.equal(element.style.width, "300px");
        }
        clean();
    }
    if (mobile) {
        return "Block panel mobile boundary cases passed";
    }

    // 切换回鼠标后恢复细把手，鼠标移动和缩放仍走原有实现。
    for (const direction of ["move", "rd"]) {
        const element = createPanel();
        pointer("pointermove");
        check.equal(element.querySelector(".resize__r").getBoundingClientRect().width, 4);
        check.equal(element.querySelector(".resize__rd").getBoundingClientRect().width, 8);
        const handle = element.querySelector(".resize__" + direction);
        const {x, y} = center(handle);
        handle.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: x, clientY: y}));
        document.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: x + 40, clientY: y + 30}));
        document.dispatchEvent(new MouseEvent("mouseup", {bubbles: true}));
        check.equal(element.dataset.pin, "true");
        check.equal(direction === "move" ? element.style.left : element.style.width, direction === "move" ? "140px" : "340px");
        clean();
    }

    for (const direction of ["move", "rd"]) {
        for (const cancel of ["touchcancel", "blur", "visibilitychange", "multitouch"]) {
            const element = createPanel();
            const handle = element.querySelector(".resize__" + direction);
            const {x, y} = center(handle);
            touch("touchstart", handle, x, y);
            touch("touchmove", handle, x + 20, y + 20);
            check.ok(document.querySelector(".touch-resize-active"));
            if (cancel === "blur") {
                window.dispatchEvent(new Event("blur"));
            } else if (cancel === "visibilitychange") {
                Object.defineProperty(document, "hidden", {configurable: true, value: true});
                document.dispatchEvent(new Event("visibilitychange"));
                Reflect.deleteProperty(document, "hidden");
            } else {
                touch(cancel === "multitouch" ? "touchstart" : cancel, handle, x + 20, y + 20, 2);
            }
            clean();
            document.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: x + 100, clientY: y + 100}));
            check.equal(direction === "move" ? element.style.left : element.style.width, direction === "move" ? "120px" : "320px");
        }
    }

    let element = createPanel();
    const move = element.querySelector(".resize__move");
    touch("touchstart", move, 180, 120);
    touch("touchend", move, 180, 120);
    check.equal(element.dataset.pin, "false", "a tap does not pin the panel");
    clean();
    const content = element.querySelector<HTMLElement>("[contenteditable]");
    content.insertAdjacentHTML("beforeend", '<span class="resize__move">Nested content</span>');
    content.insertAdjacentHTML("beforeend", '<span class="resize__r">Nested handle</span>');
    check.equal(content.lastElementChild.getBoundingClientRect().width, 4, "nested controls retain their hit area");
    for (const target of [content, content.firstElementChild, element.querySelector('[data-type="pin"]'),
        element.querySelector('[data-type="close"]')]) {
        const {x, y} = center(target);
        touch("touchstart", target, x, y);
        check.equal(document.onmousemove, null, "content and controls do not start dragging");
        check.equal(touch("touchmove", target, x, y + 30).defaultPrevented, false, "content keeps native scrolling");
        touch("touchend", target, x, y + 30);
        clean();
    }
    const selection = getSelection();
    selection.selectAllChildren(content);
    check.match(selection.toString(), /Editable block content/, "native text selection remains available");
    selection.removeAllRanges();
    (element.querySelector('[data-type="pin"]') as HTMLElement).click();
    check.equal(element.dataset.pin, "true");
    (element.querySelector('[data-type="pin"]') as HTMLElement).click();
    check.equal(element.dataset.pin, "false");
    (element.querySelector('[data-type="close"]') as HTMLElement).click();
    check.equal(element.isConnected, false, "the close button still closes the panel");

    // 留下实际浮窗，随后用 Chromium 输入接口验证原生触摸事件序列及首次扩大的外侧命中区。
    element = createPanel();
    pointer("pointermove");
    return "Block panel touch cases passed";
};

for (const frontend of ["app", "browser", "mobile"]) {
    test(`block panel touch moving and resizing preserves ${frontend} interactions`, {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 30000,
    }, async () => {
        const mobile = frontend === "mobile";
        const sources = ["src/util/touchDragBridge.ts", "src/util/touchDragBridgeCore.ts",
            "src/dialog/moveResize.ts", "src/block/Panel.ts"].map(file => transpileModule(
            parse(readFileSync(file, "utf8"), {BROWSER: frontend !== "app", MOBILE: mobile}, false, true), {
                compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
            }).outputText);
        const css = ["_block.scss", "_resize.scss"].map(file =>
            compileString(readFileSync("src/assets/scss/business/" + file, "utf8")).css).join("\n");
        const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-panel-resize-touch-test-"));
        const script = path.join(temporary, "run.cjs");
        const expected = mobile ? "Block panel mobile boundary cases passed" : "Block panel touch cases passed";
        writeFileSync(script, `const {app, BrowserWindow} = require("electron");
const check = require("node:assert/strict");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show:false, width:800, height:600,
        webPreferences:{nodeIntegration:true, contextIsolation:false, offscreen:true}});
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        win.webContents.debugger.attach("1.3");
        await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {enabled:true});
        const result = await win.webContents.executeJavaScript(${JSON.stringify(
            "const __name = value => value; try { (" + browserCases.toString() + ")(" +
            JSON.stringify(sources) + "," + JSON.stringify(css) + "," + mobile + "); } catch (error) { error.stack; }")});
        check.equal(result, ${JSON.stringify(expected)});
        if (!${mobile}) {
            const touch = (type, x, y) => win.webContents.debugger.sendCommand("Input.dispatchTouchEvent",
                {type, touchPoints:type === "touchEnd" ? [] : [{x,y}]});
            await touch("touchStart", 200, 120);
            await touch("touchMove", 240, 150);
            await touch("touchEnd");
            check.deepEqual(await win.webContents.executeJavaScript(
                '[document.querySelector(".block__popover").style.left, document.querySelector(".block__popover").dataset.pin, document.onmousemove === null]'), ["140px", "true", true]);
            await win.webContents.executeJavaScript(
                'document.querySelector(".block__popover").style.left="100px"; document.querySelector(".block__popover").style.top="100px"; document.body.dispatchEvent(new PointerEvent("pointermove", {bubbles:true,pointerType:"mouse"}));');
            check.equal(await win.webContents.executeJavaScript('document.elementFromPoint(410,220).className'), "underlay");
            await touch("touchStart", 410, 220);
            await touch("touchMove", 450, 220);
            await touch("touchEnd");
            check.deepEqual(await win.webContents.executeJavaScript(
                '[document.querySelector(".block__popover").style.width, document.onmousemove === null, document.querySelector(".touch-resize-active") === null]'), ["340px", true, true]);
            await touch("touchStart", 250, 280);
            await touch("touchMove", 250, 180);
            await touch("touchEnd");
            await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            check.equal(await win.webContents.executeJavaScript('document.querySelector(".block__content").scrollTop > 0'), true);
        }
        console.log(result);
        win.destroy(); app.exit(0);
    } catch (error) {
        console.error(error); win.destroy(); app.exit(1);
    }
});`, "utf8");
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const result = await promisify(execFile)(require("electron") as unknown as string, [script],
                {env, timeout: 25000, windowsHide: true});
            assert.ok(result.stdout.includes(expected));
        } finally {
            if (path.dirname(path.resolve(temporary)) === path.resolve(tmpdir()) &&
                path.basename(temporary).startsWith("siyuan-panel-resize-touch-test-")) {
                rmSync(temporary, {recursive: true, force: true});
            }
        }
    });
}
