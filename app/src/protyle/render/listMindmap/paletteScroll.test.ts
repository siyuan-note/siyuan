import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string, css: string) => {
    const check = require("node:assert/strict");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const createElement = (tag: string, className: string) => {
        const element = document.createElement(tag);
        element.className = className;
        return element;
    };
    const View = new Function("createElement", source + "; return View;")(createElement);
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
    const until = async (condition: () => boolean, message: string) => {
        const deadline = performance.now() + 2000;
        while (!condition() && performance.now() < deadline) {
            await frame();
        }
        check.ok(condition(), message);
    };
    const make = () => {
        const host = createElement("div", "mindmap-view");
        host.style.cssText = "position:absolute;top:20px;left:20px;width:236px;height:140px";
        const palette = createElement("div", "mindmap-view__palette");
        for (let i = 0; i < 31; i++) {
            const button = createElement("button", "color__square color__square--compact");
            button.textContent = String(i);
            palette.append(button);
        }
        const manager = document.createElement("button");
        host.append(new View().makePaletteRow(palette, [manager]));
        document.body.append(host);
        const step = parseFloat(getComputedStyle(palette).gridTemplateColumns);
        const wheel = (x: number, y: number, options: WheelEventInit = {}) => {
            const event = new WheelEvent("wheel", {deltaX: x, deltaY: y, bubbles: true, cancelable: true, ...options});
            palette.dispatchEvent(event);
            return event;
        };
        const settled = () => until(() => !palette.hasAttribute("data-scrolling"), "scripted scrolling completes");
        const aligned = () => {
            const position = palette.scrollLeft;
            check.ok(Math.abs(position - Math.round(position / step) * step) < 1 ||
                Math.abs(position - (palette.scrollWidth - palette.clientWidth)) < 1, "a complete color column is visible");
        };
        return {host, palette, manager, step, wheel, settled, aligned};
    };

    // 小数位移在一帧内累计，反复小幅滚轮沿输入方向前进；移出色卡不会提前吸回。
    {
        const {host, palette, manager, step, wheel, settled, aligned} = make();
        const managerLeft = manager.getBoundingClientRect().left;
        let applied = 0;
        palette.addEventListener("click", () => applied++);
        for (let i = 0; i < 30; i++) {
            check.equal(wheel(0, .2).defaultPrevented, true);
        }
        await frame();
        check.ok(Math.abs(palette.scrollLeft - 6) < .6, "fine wheel input retains its accumulated displacement");
        palette.dispatchEvent(new PointerEvent("pointerleave", {pointerType: "mouse"}));
        check.equal(palette.hasAttribute("data-scrolling"), true, "leaving does not interrupt a wheel gesture");
        await settled();
        check.ok(Math.abs(palette.scrollLeft - step) < 1, "a short gesture advances to the next column");
        for (let i = 2; i <= 4; i++) {
            wheel(0, 13);
            await settled();
            check.ok(Math.abs(palette.scrollLeft - i * step) < 1, "short gestures do not repeatedly snap backwards");
        }
        wheel(0, -13);
        await settled();
        check.ok(Math.abs(palette.scrollLeft - 3 * step) < 1, "reverse wheel input returns one column");
        aligned();
        check.equal(manager.getBoundingClientRect().left, managerLeft, "settings remain fixed");
        check.equal(applied, 0, "browsing never applies a color");
        host.remove();
    }

    // 横向、斜向和 Shift 滚轮交给原生滚动，手势期间暂停吸附，纵向抖动不会改变方向。
    {
        const {host, palette, wheel} = make();
        const outer = document.createElement("div");
        outer.style.cssText = "position:absolute;top:20px;left:20px;width:300px;height:180px;overflow:auto";
        const spacer = document.createElement("div");
        spacer.style.height = "120px";
        const tail = document.createElement("div");
        tail.style.height = "1000px";
        host.style.position = "relative";
        host.style.top = "0";
        host.style.left = "0";
        outer.append(spacer, host, tail);
        document.body.append(outer);
        outer.scrollTop = 120;
        for (const [x, y] of [[4, -5], [5, -4], [0, -3]]) {
            check.equal(wheel(x, y).defaultPrevented, false, "diagonal gestures retain their native horizontal direction");
        }
        await frame();
        check.equal(palette.scrollLeft, 0, "synthetic native gestures do not trigger scripted movement");
        check.equal(palette.hasAttribute("data-scrolling"), true);
        check.equal(wheel(0, 50, {shiftKey: true}).defaultPrevented, false);
        for (const modifier of ["ctrlKey", "metaKey"]) {
            check.equal(wheel(0, 50, {[modifier]: true}).defaultPrevented, false, "zoom input stays native");
        }
        const blocked: boolean[] = [];
        palette.addEventListener("wheel", event => blocked.push(event.defaultPrevented));
        const bounds = palette.getBoundingClientRect();
        await require("electron").ipcRenderer.invoke("palette-wheel", {
            type: "mouseWheel", x: Math.round(bounds.left + bounds.width / 2),
            y: Math.round(bounds.top + bounds.height / 2), deltaX: 60, deltaY: -4,
        });
        await until(() => palette.scrollLeft > 0, "native horizontal wheel input scrolls the real palette");
        check.ok(blocked.length > 0);
        check.ok(blocked.every(value => !value), "native wheel default actions remain enabled");
        check.equal(palette.hasAttribute("data-scrolling"), true);
        await delay(80);
        check.equal(outer.scrollTop, 120, "diagonal palette scrolling preserves the outer document position");
        await require("electron").ipcRenderer.invoke("palette-wheel", {
            type: "mouseWheel", x: Math.round(bounds.left + bounds.width / 2),
            y: Math.round(bounds.top + bounds.height / 2), deltaX: 0, deltaY: 4,
        });
        await delay(350);
        check.equal(outer.scrollTop, 120, "vertical jitter at the end of a native gesture stays inside the palette");
        outer.remove();
    }

    // 连续细小横向输入必须跨过一列，不能在手势期间被强制吸附拉住。
    {
        const {host, palette, wheel} = make();
        const bounds = palette.getBoundingClientRect();
        const positions: number[] = [];
        for (let i = 0; i < 20; i++) {
            await require("electron").ipcRenderer.invoke("palette-wheel", {
                type: "mouseWheel", x: Math.round(bounds.left + bounds.width / 2),
                y: Math.round(bounds.top + bounds.height / 2), deltaX: 2, deltaY: 0,
            });
            await delay(20);
            positions.push(palette.scrollLeft);
        }
        check.ok(palette.scrollLeft > 30, "continuous fine horizontal wheel input makes progress: " + JSON.stringify(positions));
        check.equal(palette.hasAttribute("data-scrolling"), true, "snapping stays disabled throughout the gesture");
        await delay(180);
        palette.scrollBy({left: 1, behavior: "instant"});
        await delay(180);
        check.equal(palette.hasAttribute("data-scrolling"), true, "continued native scrolling delays alignment after the last wheel event");
        check.equal(wheel(0, -3).defaultPrevented, false,
            "late vertical jitter during horizontal inertia does not switch to scripted scrolling");
        await until(() => !palette.hasAttribute("data-scrolling"), "horizontal input aligns after the gesture");
        check.ok(palette.scrollLeft > 30);
        host.remove();
    }

    // 原生惯性滚动不受纵向滚轮的定时对齐干扰；新的输入可中断平滑停靠。
    {
        const {host, palette, step, wheel, settled} = make();
        wheel(0, 13);
        await frame();
        const samples = [palette.scrollLeft];
        while (palette.hasAttribute("data-scrolling")) {
            await frame();
            samples.push(palette.scrollLeft);
            check.ok(samples.length < 120, "smooth alignment completes");
        }
        check.ok(samples.some(value => value > 14 && value < step - 1), "alignment animates through intermediate positions");
        check.ok(samples.every(value => value >= 12), "short input is never pulled back to the starting column");
        wheel(0, 13);
        await until(() => palette.scrollLeft > step + 14, "the next alignment starts");
        const beforeReverse = palette.scrollLeft;
        wheel(0, -5);
        await frame();
        check.ok(palette.scrollLeft < beforeReverse, "new input interrupts the pending alignment");
        await settled();
        check.ok(Math.abs(palette.scrollLeft - step) < 1, "interrupted alignment follows the new input direction");
        wheel(0, 13);
        await frame();
        wheel(10, 0);
        check.equal(palette.hasAttribute("data-scrolling"), true, "horizontal input keeps snapping disabled while scrolling");
        await settled();
        const nativePosition = palette.scrollLeft;
        await delay(650);
        check.equal(palette.scrollLeft, nativePosition, "a stale timer cannot change a native gesture");
        host.remove();
    }

    // 行、页单位及边界反向输入保持有效；键盘和触屏可接管尚未结束的滚动。
    for (const mode of [WheelEvent.DOM_DELTA_LINE, WheelEvent.DOM_DELTA_PAGE]) {
        const {host, palette, wheel, settled, aligned} = make();
        wheel(0, 1, {deltaMode: mode});
        await frame();
        const expected = mode === WheelEvent.DOM_DELTA_LINE ? 16 : palette.clientWidth;
        check.ok(Math.abs(palette.scrollLeft - expected) < 1);
        await settled();
        aligned();
        wheel(0, 10000);
        await frame();
        const end = palette.scrollLeft;
        wheel(0, -13);
        await frame();
        check.ok(palette.scrollLeft < end, "reverse input responds immediately at the end");
        await settled();
        aligned();
        wheel(0, -13);
        await frame();
        palette.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true}));
        check.equal(palette.hasAttribute("data-scrolling"), false);
        const keyboardPosition = palette.scrollLeft;
        await delay(650);
        check.equal(palette.scrollLeft, keyboardPosition, "keyboard navigation cancels pending wheel work");
        wheel(0, -13);
        palette.dispatchEvent(new PointerEvent("pointerdown", {pointerType: "touch", pointerId: 1}));
        check.equal(palette.hasAttribute("data-scrolling"), false, "touch input restores native snapping");
        host.remove();
    }

    // 缺少 scrollend 的环境仍可完成对齐并继续使用下一次滚轮。
    {
        const {host, palette, step, wheel, settled} = make();
        palette.addEventListener("scrollend", event => event.stopImmediatePropagation(), {capture: true});
        wheel(0, 13);
        await settled();
        check.ok(Math.abs(palette.scrollLeft - step) < 1);
        wheel(0, 13);
        await settled();
        check.ok(Math.abs(palette.scrollLeft - 2 * step) < 1);
        host.remove();
    }

    // 系统要求减少动态效果时直接停靠，不播放补齐动画。
    {
        await require("electron").ipcRenderer.invoke("palette-motion", "reduce");
        const {host, palette, step, wheel} = make();
        wheel(0, 13);
        const samples: number[] = [];
        while (palette.hasAttribute("data-scrolling")) {
            await frame();
            samples.push(palette.scrollLeft);
            check.ok(samples.length < 120);
        }
        check.ok(Math.abs(palette.scrollLeft - step) < 1);
        check.equal(samples.some(value => value > 14 && value < step - 1), false,
            "reduced motion skips intermediate alignment positions");
        host.remove();
        await require("electron").ipcRenderer.invoke("palette-motion", "no-preference");
    }

    // 工具栏重绘或销毁后，待执行帧不再写入已移除的色卡。
    {
        const {host, palette, wheel} = make();
        let scrollCalls = 0;
        palette.scrollTo = () => scrollCalls++;
        wheel(0, 13);
        host.remove();
        await frame();
        await delay(650);
        check.equal(scrollCalls, 0);
        check.equal(palette.hasAttribute("data-scrolling"), false);
    }
    return "Palette scroll cases passed";
};

for (const scale of [1, 2]) {
    test(`palette scrolling preserves fine input, native gestures and smooth alignment at DPR ${scale}`, {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 30000,
    }, async () => {
        const file = createSourceFile("view.ts", readFileSync(path.join(__dirname, "view.ts"), "utf8"), ScriptTarget.Latest, true);
        const view = file.statements.find(item => isClassDeclaration(item) && item.name?.text === "ListMindmapView");
        assert.ok(view && isClassDeclaration(view));
        const method = view.members.find(item => item.name?.getText(file) === "makePaletteRow");
        assert.ok(method);
        const source = transpileModule(`class View { tooltip = {hidden: true}; ${method.getText(file)} }`, {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText;
        const css = ["business/_color.scss", "protyle/_mindmap-view.scss"].map(name =>
            require("sass").compile(path.resolve(__dirname, "../../../assets/scss", name),
                {logger: require("sass").Logger.silent}).css).join("\n");
        const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-palette-scroll-"));
        const script = path.join(temporary, "run.cjs");
        const browserSource = transpileModule(`(${browserCases.toString()})`, {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText.trim().replace(/^"use strict";\s*/, "").replace(/;$/, "");
        writeFileSync(script, `const {app, BrowserWindow, ipcMain} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("force-device-scale-factor", "${scale}");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 600, height: 400,
        webPreferences: {nodeIntegration: true, contextIsolation: false, offscreen: true}});
    win.webContents.debugger.attach("1.3");
    ipcMain.handle("palette-wheel", async (_event, input) => {
        await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", input);
    });
    ipcMain.handle("palette-motion", async (_event, value) => {
        await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
            features: [{name: "prefers-reduced-motion", value}],
        });
    });
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
            `const __name = value => value; (${browserSource})(${JSON.stringify(source)}, ${JSON.stringify(css)})`)}));
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
            const result = await promisify(execFile)(require("electron") as unknown as string, [script], {
                env, timeout: 25000, windowsHide: true,
            });
            assert.match(result.stdout, /Palette scroll cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
            rmSync(temporary, {recursive: true, force: true});
        }
    });
}
