import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import * as path from "node:path";
import {promisify} from "node:util";
import test from "node:test";
import {compile} from "sass";
import {ScriptTarget, transpileModule} from "typescript";

const browserCases = (source: string, css: string) => {
    const check = require("node:assert/strict");
    const position = new Function(source + "; return positionBlockPanel;")() as
        typeof import("./panelPosition").positionBlockPanel;
    const style = document.createElement("style");
    style.textContent = ":root { --b3-theme-surface-lighter: #ddd; }" + css;
    document.head.append(style);
    document.body.style.margin = "0";
    const toolbar = document.createElement("div");
    toolbar.id = "toolbar";
    toolbar.style.height = "32px";
    document.body.append(toolbar);

    const anchor = (top: number, left = 100) => new DOMRect(left, top, 160, 30);
    const createPanel = (height: number) => {
        document.querySelector(".block__popover")?.remove();
        const element = document.createElement("div");
        element.className = "block__popover";
        element.innerHTML = '<div class="block__icons"></div><div class="block__content"><div></div></div>';
        (element.lastElementChild.firstElementChild as HTMLElement).style.cssText =
            `height:${height - 44}px; flex-shrink:0;`;
        document.body.append(element);
        return element;
    };
    const assertAbove = (element: HTMLElement, target: DOMRect) => {
        const rect = element.getBoundingClientRect();
        check.ok(rect.top >= toolbar.clientHeight, "popover clears the top bar");
        check.ok(Math.abs(rect.bottom - (target.top - 8)) < 1, "popover stays adjacent to the anchor above");
        check.ok(rect.height > 350, "long content uses the available space instead of the minimum height");
    };

    // 中下部的长浮窗在上下均放不下时，应完整利用上方空间。
    let target = anchor(500);
    let element = createPanel(600);
    position(element, target);
    assertAbove(element, target);
    check.ok(element.getBoundingClientRect().height >= 459);

    // 长度与加载时机不应导致同一位置的浮窗被压缩。
    element = createPanel(1600);
    position(element, target);
    assertAbove(element, target);
    position(element, target);
    assertAbove(element, target);

    target = anchor(180);
    element = createPanel(1000);
    position(element, target);
    check.equal(element.getBoundingClientRect().top, target.bottom + 4);
    check.ok(element.getBoundingClientRect().bottom <= window.innerHeight - 8);
    check.ok(element.getBoundingClientRect().height > 600);

    // 内容较少时保留向下展开，后续内容可在可用范围内增长。
    target = anchor(500);
    element = createPanel(250);
    position(element, target);
    check.equal(element.getBoundingClientRect().top, target.bottom + 4);
    check.equal(element.getBoundingClientRect().height, 250);
    (element.lastElementChild.firstElementChild as HTMLElement).style.height = "1000px";
    check.ok(element.getBoundingClientRect().bottom <= window.innerHeight - 8);

    // 上方短浮窗应保持与锚点相邻，并限制后续内容向下侵入锚点。
    target = anchor(760);
    element = createPanel(250);
    position(element, target);
    check.equal(element.getBoundingClientRect().bottom, target.top - 8);
    check.equal(element.getBoundingClientRect().height, 250);
    (element.lastElementChild.firstElementChild as HTMLElement).style.height = "1000px";
    check.ok(element.getBoundingClientRect().bottom <= target.top - 8);

    // 窗口右侧和分数像素坐标仍保留拖拽空间。
    target = anchor(500.5, window.innerWidth - 20);
    element = createPanel(600);
    position(element, target);
    assertAbove(element, target);
    check.ok(element.getBoundingClientRect().right <= window.innerWidth - 8);

    // 主题采用不同盒模型、边框及内边距时，仍按浮窗外框计算可用空间。
    for (const boxSizing of ["content-box", "border-box"]) {
        element = createPanel(600);
        element.style.boxSizing = boxSizing;
        element.style.borderWidth = "3px";
        element.style.padding = "4px";
        position(element, target);
        assertAbove(element, target);
    }

    // 移动端插件共用浮窗组件，布局使用较宽的浮窗且无桌面工具栏。
    toolbar.remove();
    const sidebar = document.createElement("div");
    sidebar.id = "sidebar";
    document.body.append(sidebar);
    target = anchor(500);
    element = createPanel(600);
    element.style.width = "80vw";
    position(element, target);
    assertAbove(element, target);
    check.equal(element.getBoundingClientRect().top, 0);

    // 可用空间较小时，最小高度也必须服从窗口边界。
    toolbar.style.height = "600px";
    sidebar.remove();
    document.body.append(toolbar);
    target = anchor(730);
    element = createPanel(600);
    position(element, target);
    check.ok(element.getBoundingClientRect().top >= 600);
    check.ok(element.getBoundingClientRect().bottom <= window.innerHeight - 8);
    check.equal(element.getBoundingClientRect().top, target.bottom + 4);
    return "Block panel positioning cases passed";
};

test("block popovers use available space without collapsing or covering their anchors", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 20000,
}, async () => {
    const source = ["../layout/getTopBarHeight.ts", "../util/setPosition.ts", "panelPosition.ts"].map(file =>
        transpileModule(readFileSync(path.join(__dirname, file), "utf8")
            .replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""),
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText).join("\n");
    const css = compile(path.join(__dirname, "../assets/scss/business/_block.scss")).css;
    const temporary = mkdtempSync(path.join(tmpdir(), "siyuan-panel-position-test-"));
    const script = path.join(temporary, "run.cjs");
    writeFileSync(script, `const {app, BrowserWindow} = require("electron");
app.setPath("userData", ${JSON.stringify(path.join(temporary, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
    for (const width of [1200, 400]) {
        const win = new BrowserWindow({show: false, width, height: 900, useContentSize: true,
            webPreferences: {nodeIntegration: true, contextIsolation: false}});
        try {
            // 创建窗口时可能受屏幕工作区限制，显式设置内容尺寸以固定测试视口。
            win.setContentSize(width, 900);
            await win.loadURL("data:text/html,<html><body></body></html>");
            const viewport = await win.webContents.executeJavaScript("[innerWidth, innerHeight]");
            require("node:assert/strict").deepEqual(viewport, [width, 900]);
            const result = await win.webContents.executeJavaScript(${JSON.stringify(
        `(() => { const __name = value => value; try {
            return (${browserCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(css)});
        } catch (error) { return error.stack; } })()`)});
            if (result !== "Block panel positioning cases passed") {
                throw new Error(result);
            }
            console.log(result);
            win.destroy();
        } catch (error) {
            console.error(error);
            win.destroy();
            app.exit(1);
            return;
        }
    }
    app.exit(0);
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const executable = require("electron") as unknown as string;
        const result = await promisify(execFile)(executable, [script], {env, timeout: 15000, windowsHide: true});
        assert.match(result.stdout, /Block panel positioning cases passed/);
    } finally {
        const resolvedTemporary = path.resolve(temporary);
        assert.equal(path.dirname(resolvedTemporary), path.resolve(tmpdir()));
        assert.ok(path.basename(resolvedTemporary).startsWith("siyuan-panel-position-test-"));
        rmSync(resolvedTemporary, {recursive: true, force: true});
    }
});
