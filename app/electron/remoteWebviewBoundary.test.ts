import {EventEmitter} from "node:events";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {state} from "./shared/runtime";
import {kernelWindowPreferences} from "./window/windowPreferences";
import {rememberWindowKernelTarget} from "./window/windowLifecycle";
import type {BrowserWindow, Session} from "electron";
import type {KernelTarget} from "./shared/types";
const assert = require("node:assert/strict");

// 测试直接在共享状态上放容器，入口不再转发状态，用例各自还原即可；清空而不替换，保持引用不变。
const resetState = () => {
    state.windows.targets.clear();
    state.windows.initialized.clear();
    state.windows.expectedRendererExit.clear();
    state.workspaces.length = 0;
};

test("remote windows reject guests while local plugin guests keep their original attachment capabilities", () => {
    // 启动流程在 startup/bootstrap.ts，入口只剩环境变量与调用；两者都不得再引入跨进程消息桥。
    const entry = readFileSync(join(__dirname, "startup", "bootstrap.ts"), "utf8") +
        readFileSync(join(__dirname, "main.ts"), "utf8");
    assert.doesNotMatch(entry, /mapHostManager|createMapHostManager|MessageChannelMain/);
    for (const mode of ["local", "remote"] as const) {
        resetState();
        state.windows.initialized.add(42);
        const cleaned = [];
        const dragCleanup = {
            session: id => cleaned.push(["session", id]),
            window: id => cleaned.push(["window", id]),
        };
        const contents = Object.assign(new EventEmitter(), {id: 42});
        const win = Object.assign(new EventEmitter(), {webContents: contents});
        const target: KernelTarget = {mode, origin: "https://example.invalid", ownsKernel: false, port: "6806"};
        // 窗口与清理器只实现被测路径用到的成员，因此在调用处转换到生产类型。
        rememberWindowKernelTarget(win as unknown as BrowserWindow, target,
            dragCleanup as unknown as Parameters<typeof rememberWindowKernelTarget>[2]);
        assert.equal(state.windows.targets.get(contents.id), target);

        let blocked = 0;
        const guestPreferences = {nodeIntegration: true, preload: "/plugin/preload.js"};
        contents.emit("will-attach-webview", {preventDefault() { blocked++; }}, guestPreferences,
            {src: "https://plugin.invalid"});
        assert.equal(blocked, mode === "remote" ? 1 : 0);
        assert.deepEqual(guestPreferences, {nodeIntegration: true, preload: "/plugin/preload.js"});
        assert.equal(contents.listenerCount("will-attach-webview"), mode === "remote" ? 1 : 0);

        contents.emit("will-frame-navigate", {isMainFrame: false, preventDefault() { blocked++; }});
        contents.emit("will-frame-navigate", {isMainFrame: true, preventDefault() { blocked++; }});
        assert.equal(blocked, mode === "remote" ? 2 : 0);

        contents.emit("did-start-navigation", {isMainFrame: true, isSameDocument: false});
        assert.equal(state.windows.initialized.has(42), false);
        contents.emit("destroyed");
        assert.equal(state.windows.targets.has(42), false);
        assert.deepEqual(cleaned, [["session", 42], ["window", 42]]);
    }
});

test("main and detached windows enable local webviews and disable remote webviews", () => {
    // 两个窗口共用同一份 webPreferences，因此只需断言这份定义本身。
    for (const mode of ["local", "remote"] as const) {
        const remoteSession = {};
        const preferences = kernelWindowPreferences(
            {mode, origin: "https://example.invalid", ownsKernel: true, port: "6806"},
            () => remoteSession as unknown as Session);
        assert.equal(preferences.webviewTag, mode === "local");
        assert.equal(preferences.webSecurity, mode === "remote");
        assert.equal(preferences.nodeIntegration, true);
        assert.equal(preferences.nodeIntegrationInSubFrames, false);
        assert.equal(preferences.nodeIntegrationInWorker, false);
        assert.equal(preferences.contextIsolation, false);
        assert.equal(preferences.session, mode === "remote" ? remoteSession : undefined);
    }
});
