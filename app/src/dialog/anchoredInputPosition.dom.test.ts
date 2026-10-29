import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = async (source: string) => {
    const check: typeof assert = require("node:assert/strict");
    const api = {} as typeof import("./anchoredInputPosition");
    new Function("exports", "require", source)(api, () => ({isMobile: () => true}));
    const viewport = Object.assign(new EventTarget(), {offsetLeft: 0, offsetTop: 0, width: 384, height: 808});
    Object.defineProperty(window, "visualViewport", {configurable: true, value: viewport});
    // 隐藏测试窗口不依赖系统绘制帧率；定位回调仍异步执行，焦点及选区使用真实 DOM。
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 0);
    window.cancelAnimationFrame = id => window.clearTimeout(id);
    const settle = () => new Promise(resolve => setTimeout(resolve, 30));
    for (const type of ["block", "url", "number"]) {
        document.body.innerHTML = `<div id="content" style="position:fixed;inset:0">
<div id="anchor" style="position:absolute;left:55px;top:167px;width:141px;height:33px"></div></div>
<div id="mask" style="position:fixed;inset:0"></div>`;
        const anchor = document.getElementById("anchor");
        const mask = document.getElementById("mask");
        const input = document.createElement(type === "number" ? "input" : "textarea");
        if (input instanceof HTMLInputElement) {
            input.type = "number";
        }
        input.style.cssText = "position:absolute;box-sizing:border-box";
        input.value = type === "number" ? "" : "draft";
        mask.append(input);
        let focusouts = 0;
        input.addEventListener("focusout", () => focusouts++);
        const dispose = api.bindAnchoredInputPosition(input, () => anchor, document.getElementById("content"));
        input.focus();
        if (type !== "number") {
            input.setSelectionRange(2, 4);
            input.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
        }
        await settle();
        // 真机键盘打开时先报告 145px，随后恢复到稳定的 476px；输入框不能在过渡帧中失焦。
        for (const height of [145, 476, 0, 476]) {
            viewport.height = height;
            viewport.dispatchEvent(new Event("resize"));
            await settle();
            check.equal(document.activeElement, input, `${type}: keyboard resize retains focus`);
            check.equal(focusouts, 0);
            check.equal(getComputedStyle(input).visibility, "visible");
            if (height > 0) {
                const bounds = input.getBoundingClientRect();
                check.ok(bounds.top >= 0 && bounds.bottom <= height, `${type}: input stays above the keyboard`);
            }
            if (type !== "number") {
                check.equal(input.value, "draft");
                check.equal(input.selectionStart, 2);
                check.equal(input.selectionEnd, 4);
            }
        }
        if (type !== "number") {
            input.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true, data: "X"}));
        }
        check.equal(document.execCommand("insertText", false, type === "number" ? "12" : "X"), true);
        check.equal(input.value, type === "number" ? "12" : "drXt");
        viewport.height = 808;
        viewport.dispatchEvent(new Event("resize"));
        await settle();
        check.equal(input.getBoundingClientRect().top, 167);
        check.equal(document.activeElement, input);
        // 真正移除锚点仍应隐藏编辑框，而不是把失效草稿留在屏幕上。
        anchor.remove();
        await settle();
        check.equal(getComputedStyle(input).visibility, "hidden");
        dispose();
        mask.remove();
    }
    return "Anchored input DOM cases passed";
};

test("mobile primary, URL and number inputs retain real DOM focus, selection and edits during keyboard resizing", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 45000,
}, async () => {
    const source = transpileModule(readFileSync(path.join(__dirname, "anchoredInputPosition.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-anchored-input-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    const win = new BrowserWindow({show: false, width: 384, height: 808,
        webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false}});
    try {
        await win.loadURL("about:blank");
        console.log(await win.webContents.executeJavaScript(${JSON.stringify(
        `const __name = value => value; (${browserCases.toString()})(${JSON.stringify(source)})`)}));
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
        const {stdout} = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, timeout: 40000, windowsHide: true});
        assert.match(stdout, /Anchored input DOM cases passed/);
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
        assert.ok(path.basename(temporary).startsWith("siyuan-anchored-input-test-"));
        rmSync(temporary, {recursive: true, force: true});
    }
});
