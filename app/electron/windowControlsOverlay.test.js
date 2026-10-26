const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const {getCaptionHeight, getTitleBarOverlayOptions, updateTitleBarOverlay} = require("./windowControlsOverlay");

test("caption overlays are Windows-only and keep the page background visible", () => {
    assert.deepEqual(getTitleBarOverlayOptions("win32"), {color: "#00000000", symbolColor: "#808080", height: 32});
    assert.deepEqual(getTitleBarOverlayOptions("win32", getCaptionHeight(false, true)),
        {color: "#00000000", symbolColor: "#808080", height: 42});
    assert.equal(getTitleBarOverlayOptions("darwin"), false);
    assert.equal(getTitleBarOverlayOptions("linux"), false);
    assert.equal(getTitleBarOverlayOptions("linux", getCaptionHeight(false, true)), false);
});

test("first-frame caption heights cover every window and density combination", () => {
    // 工具栏高度：普通顶栏与设置窗口；面板高度：融合页签与独立文档窗口。
    assert.equal(getCaptionHeight(false, false), 32);
    assert.equal(getCaptionHeight(false, true), 42);
    assert.equal(getCaptionHeight(true, false), 28);
    assert.equal(getCaptionHeight(true, true), 34);
    // 非布尔输入按舒适密度处理，避免外部传入字符串时算出非法高度。
    assert.equal(getCaptionHeight(undefined, undefined), 32);
    assert.equal(getCaptionHeight("compact", "panel"), 32);
    assert.equal(getTitleBarOverlayOptions("win32", getCaptionHeight(true, false)).height, 28);
    assert.equal(getTitleBarOverlayOptions("win32", getCaptionHeight(true, true)).height, 34);
});

// 首帧高度与界面密度的顶栏尺寸共用同一组数字，避免渲染进程加载前按钮区与顶栏错位。
test("first-frame caption heights follow the density toolbar and panel heights", () => {
    const main = readFileSync(path.resolve(__dirname, "../src/assets/scss/main/_main.scss"), "utf8");
    const density = readFileSync(path.resolve(__dirname, "../src/assets/scss/util/_density.scss"), "utf8");
    const declared = (source, name) => Number(new RegExp(`var\\(--b3-ui-${name}, (\\d+)px\\)`).exec(source)[1]);
    const compactSize = name => Number(new RegExp(`"${name}": (\\d+)px`).exec(density)[1]);
    assert.equal(getCaptionHeight(false, false), declared(main, "toolbar-height"));
    assert.equal(getCaptionHeight(false, true), declared(main, "panel-height"));
    assert.equal(getCaptionHeight(true, false), compactSize("toolbar-height"));
    assert.equal(getCaptionHeight(true, true), compactSize("panel-height"));
});

test("caption height and color updates deduplicate independently per window and preserve transparent backgrounds", () => {
    const calls = [];
    const win = {isDestroyed: () => false, setTitleBarOverlay: style => calls.push(style)};
    const data = {height: 42, symbolColor: "rgb(85, 85, 85)", color: "#ffffff"};
    assert.equal(updateTitleBarOverlay(win, data, "win32"), true);
    assert.equal(updateTitleBarOverlay(win, data, "win32"), true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], {color: "#00000000", height: 42});
    assert.deepEqual(calls[1], {color: "#00000000", symbolColor: data.symbolColor});
    assert.equal(updateTitleBarOverlay(win, {...data, height: 63}, "win32"), true);
    assert.deepEqual(calls.at(-1), {color: "#00000000", height: 63});
    assert.equal(updateTitleBarOverlay(win, {...data, height: 63, symbolColor: "rgba(255, 0, 0, 0.5)"}, "win32"), true);
    assert.deepEqual(calls.at(-1), {color: "#00000000", symbolColor: "rgba(255, 0, 0, 0.5)"});
    assert.equal(updateTitleBarOverlay({...win}, data, "win32"), true);
    assert.equal(calls.length, 6);
});

test("invalid caption dimensions, unavailable windows and non-Windows updates are ignored", () => {
    const win = {isDestroyed: () => false, setTitleBarOverlay: () => assert.fail("invalid update reached Electron")};
    for (const height of [NaN, Infinity, -1, 0, 0.5, 257, "42", undefined]) {
        assert.equal(updateTitleBarOverlay(win, {height, symbolColor: "#ffffff"}, "win32"), false);
    }
    assert.equal(updateTitleBarOverlay(win, null, "win32"), false);
    assert.equal(updateTitleBarOverlay(undefined, {}, "win32"), false);
    assert.equal(updateTitleBarOverlay({...win, isDestroyed: () => true}, {}, "win32"), false);
    assert.equal(updateTitleBarOverlay(win, {height: 42, symbolColor: "#fff"}, "linux"), false);
    assert.equal(updateTitleBarOverlay(win, {height: 42, symbolColor: "#fff"}, "darwin"), false);
});

test("missing or malformed symbol colors do not block valid height updates", () => {
    const calls = [];
    const win = {isDestroyed: () => false, setTitleBarOverlay: style => calls.push(style)};
    for (const symbolColor of [undefined, 1, "", "x".repeat(101)]) {
        assert.equal(updateTitleBarOverlay(win, {height: 42, symbolColor}, "win32"), false);
    }
    assert.deepEqual(calls, [{color: "#00000000", height: 42}]);
});

test("native color rejection leaves the height applied and does not cache a failed color", () => {
    const calls = [];
    const win = {isDestroyed: () => false, setTitleBarOverlay: style => {
        calls.push(style);
        if (style.symbolColor === "oklch(0.7 0.15 150)") throw new Error("unsupported color");
    }};
    assert.equal(updateTitleBarOverlay(win, {height: 32, symbolColor: "#808080"}, "win32"), true);
    assert.equal(updateTitleBarOverlay(win, {height: 63, symbolColor: "oklch(0.7 0.15 150)"}, "win32"), false);
    assert.deepEqual(calls[2], {color: "#00000000", height: 63});
    assert.equal(updateTitleBarOverlay(win, {height: 63, symbolColor: "oklch(0.7 0.15 150)"}, "win32"), false);
    assert.equal(calls.length, 5, "failed colors are retried without repeating the successful height update");
    assert.equal(updateTitleBarOverlay(win, {height: 63, symbolColor: "rgba(76, 184, 106, 1)"}, "win32"), true);
    assert.deepEqual(calls.at(-1), {color: "#00000000", symbolColor: "rgba(76, 184, 106, 1)"});
    assert.equal(updateTitleBarOverlay(win, {height: 63, symbolColor: "rgba(76, 184, 106, 1)"}, "win32"), true);
    assert.equal(calls.length, 6);
});

test("failed native caption updates do not poison later retries", () => {
    let fail = true;
    let calls = 0;
    const win = {isDestroyed: () => false, setTitleBarOverlay: () => {
        calls++;
        if (fail) throw new Error("overlay is not ready");
    }};
    const style = {height: 32, symbolColor: "#555555"};
    assert.equal(updateTitleBarOverlay(win, style, "win32"), false);
    fail = false;
    assert.equal(updateTitleBarOverlay(win, style, "win32"), true);
    assert.equal(calls, 3);
});
