const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {compileAnchoredInputRuntime} = require("./fixtures/anchoredInputRuntime.cjs");

const runCases = async (source, css) => {
    const assert = require("node:assert/strict");
    const exports = new Function("return " + source)();
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const content = document.createElement("div");
    content.style.cssText = "position:absolute;left:20px;top:30px;width:600px;height:480px;overflow:auto";
    const cell = document.createElement("div");
    cell.style.cssText = "position:absolute;left:40px;top:50px;width:220.333px;height:36.333px";
    content.append(cell);
    document.body.append(content);
    const mask = document.createElement("div");
    mask.className = "av__mask";
    const input = document.createElement("textarea");
    input.className = "b3-text-field";
    input.style.position = "absolute";
    input.value = "draft\n".repeat(40);
    mask.append(input);
    document.body.append(mask);
    const settle = async () => {
        for (let i = 0; i < 4; i++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    };
    const dispose = exports.bindAnchoredInputPosition(input, () => cell, content);
    const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.1, `${actual} != ${expected}`);
    const aligned = () => {
        const inputRect = input.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        closeTo(inputRect.left, cellRect.left);
        closeTo(inputRect.top, cellRect.top);
    };
    await settle();
    // 浏览器会规范化小数尺寸；自动更新不能因此被误判为手动拖拽。
    cell.style.width = "230.667px";
    await settle();
    closeTo(input.getBoundingClientRect().width, cell.getBoundingClientRect().width);
    input.style.width = "420px";
    input.style.height = "240px";
    await settle();
    aligned();
    // 模拟缩小编辑区，仅由真实 ResizeObserver 驱动定位。
    content.style.width = "260px";
    content.style.height = "130px";
    await settle();
    aligned();
    closeTo(input.getBoundingClientRect().width, 220);
    closeTo(input.getBoundingClientRect().height, 80);
    closeTo(input.getBoundingClientRect().right, content.getBoundingClientRect().right);
    closeTo(input.getBoundingClientRect().bottom, content.getBoundingClientRect().bottom);
    input.style.width = "190px";
    await settle();
    content.style.width = "600px";
    content.style.height = "480px";
    await settle();
    closeTo(input.getBoundingClientRect().width, 190);
    closeTo(input.getBoundingClientRect().height, 240);
    aligned();
    // 监听内联尺寸写入，确保自身尺寸通知收敛，且不会持续触发定位更新。
    let mutations = 0;
    const observer = new MutationObserver(records => {mutations += records.length;});
    observer.observe(input, {attributes: true, attributeFilter: ["style"]});
    await settle();
    assert.equal(mutations, 0);
    observer.disconnect();
    assert.equal(input.value, "draft\n".repeat(40));
    dispose();
    mask.remove();
    content.remove();
    style.remove();
};

if (process.versions.electron && process.type === "browser") {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.whenReady().then(async () => {
        const win = new BrowserWindow({show: false, width: 800, height: 600,
            webPreferences: {nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true}});
        let code = 0;
        try {
            await win.loadURL("data:text/html,<html><body></body></html>");
            const source = compileAnchoredInputRuntime("./anchoredInputPosition");
            const css = require("sass").compile(path.join(__dirname, "../src/assets/scss/component/_text-field.scss")).css;
            await win.webContents.executeJavaScript(`(${runCases.toString()})(${JSON.stringify(source)}, ${JSON.stringify(css)})`);
        } catch (error) {
            console.error(error);
            code = 1;
        } finally {
            win.destroy();
            app.exit(code);
        }
    });
} else {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("cell input layout follows resizing and restores manual dimensions without observer loops", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-cell-input-position-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await promisify(execFile)(require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 30000});
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
