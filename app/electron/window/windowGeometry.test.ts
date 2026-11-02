// 窗口几何（`windowGeometry.ts`）：校验来自本地存储的边界、跨屏可达性判定与恢复顺序。
import {EventEmitter} from "node:events";
import {test} from "node:test";
import {captureWindowGeometry, normalizeWindowGeometry, restoreWindowGeometry} from "./windowGeometry";
import type {BrowserWindow, Screen} from "electron";
const assert = require("node:assert/strict");

const state = (values = {}) => ({version: 1, x: 100, y: 80, width: 900, height: 700,
    maximized: false, fullscreen: false, ...values});
const display = {workArea: {x: 0, y: 0, width: 1920, height: 1040}};
const screen = {getDisplayMatching: () => display, getAllDisplays: () => [display]};
const fixture = (initial = state()) => {
    const window = new EventEmitter() as EventEmitter & {
        isDestroyed(): boolean;
        isMaximized(): boolean;
        isFullScreen(): boolean;
        isMinimized(): boolean;
        getNormalBounds(): {x: number; y: number; width: number; height: number};
        unmaximize(): void;
        maximize(): void;
        setBounds(bounds: unknown): void;
        setFullScreen(value: boolean): void;
    } & BrowserWindow;
    const calls = [];
    Object.assign(window, {
        isDestroyed: () => false,
        isMaximized: () => initial.maximized,
        isFullScreen: () => initial.fullscreen,
        isMinimized: () => false,
        getNormalBounds: () => ({x: initial.x, y: initial.y, width: initial.width, height: initial.height}),
        unmaximize: () => calls.push("unmaximize"),
        maximize: () => calls.push("maximize"),
        setBounds: bounds => calls.push(bounds),
        setFullScreen: value => {
            calls.push(["fullscreen", value]);
            initial.fullscreen = value;
        },
    });
    return {window, calls};
};

test("最大化窗口保存普通窗口边界和状态", () => {
    const saved = state({maximized: true});
    assert.deepEqual(captureWindowGeometry(fixture(saved).window), saved);
});

test("负坐标显示器上的布局保持原大小和位置", () => {
    const saved = state({x: -1500, y: 80});
    assert.deepEqual(normalizeWindowGeometry(saved, {
        getDisplayMatching: () => ({workArea: {x: -1920, y: 0, width: 1920, height: 1080}}),
        getAllDisplays: () => [{workArea: {x: -1920, y: 0, width: 1920, height: 1080}}],
    } as unknown as Screen), {x: -1500, y: 80, width: 900, height: 700});
});

test("跨屏窗口保留原位置和超过单个显示器的宽度", () => {
    const right = {workArea: {x: 1920, y: 0, width: 1920, height: 1040}};
    const screens = {getAllDisplays: () => [display, right], getDisplayMatching: () => right};
    for (const bounds of [{x: 1600, y: 100, width: 1000, height: 700}, {x: 800, y: 100, width: 2800, height: 700}]) {
        assert.deepEqual(normalizeWindowGeometry(state(bounds), screens as unknown as Screen), bounds);
    }
});

test("部分移出屏幕但标题栏仍可操作时保留边界", () => {
    const bounds = {x: -100, y: 100, width: 900, height: 1100};
    assert.deepEqual(normalizeWindowGeometry(state(bounds), screen as unknown as Screen), bounds);
});

test("仅内容可见或标题栏可见区域过小时移回工作区", () => {
    for (const bounds of [{x: 100, y: -100, width: 900, height: 700}, {x: 1900, y: 100, width: 900, height: 700}]) {
        const restored = normalizeWindowGeometry(state(bounds), screen as unknown as Screen);
        assert.ok(restored.x >= 0 && restored.y >= 0);
        assert.ok(restored.x + restored.width <= display.workArea.width);
        assert.ok(restored.y + restored.height <= display.workArea.height);
    }
});

test("移除显示器或缩小工作区后窗口保持可见并遵守最小尺寸", () => {
    assert.deepEqual(normalizeWindowGeometry(state({x: 5000, y: -2000, width: 3000, height: 2000}), screen as unknown as Screen),
        {x: 0, y: 0, width: 1920, height: 1040});
    assert.deepEqual(normalizeWindowGeometry(state({width: 10, height: 20}), screen as unknown as Screen),
        {x: 100, y: 80, width: 493, height: 376});
});

test("缺失、未知版本和非法窗口信息不改变窗口", async () => {
    for (const saved of [undefined, null, {}, state({version: 2}), state({width: -1}),
        state({x: Infinity}), state({height: 1.5}), state({maximized: "true"})]) {
        const f = fixture();
        assert.equal(await restoreWindowGeometry(f.window, saved, screen as unknown as Screen), false);
        assert.deepEqual(f.calls, []);
    }
});

test("先取消最大化并恢复边界，再按保存状态最大化", async () => {
    const f = fixture(state({maximized: true}));
    assert.equal(await restoreWindowGeometry(f.window, state({maximized: true}), screen as unknown as Screen), true);
    assert.deepEqual(f.calls, ["unmaximize", {x: 100, y: 80, width: 900, height: 700}, "maximize"]);
});

test("异步退出全屏后才恢复边界和全屏状态", async () => {
    const f = fixture(state({fullscreen: true}));
    let fullscreen = true;
    f.window.isFullScreen = () => fullscreen;
    f.window.setFullScreen = value => f.calls.push(["fullscreen", value]);
    const restored = restoreWindowGeometry(f.window, state({fullscreen: true}), screen as unknown as Screen);
    assert.deepEqual(f.calls, [["fullscreen", false]]);
    fullscreen = false;
    f.window.emit("leave-full-screen");
    assert.equal(await restored, true);
    assert.deepEqual(f.calls, [["fullscreen", false], {x: 100, y: 80, width: 900, height: 700}, ["fullscreen", true]]);
    assert.equal(f.window.listenerCount("leave-full-screen"), 0);
});


