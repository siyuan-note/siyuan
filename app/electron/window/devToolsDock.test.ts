import {isDevToolsShortcut, openDevTools, toggleDevTools} from "./devToolsDock";
import type {WebContents} from "electron";
const test = require("node:test");
const assert = require("node:assert/strict");

// 开发者工具桩按 WebContents 的真实签名派生，只实现被测路径读取与调用的成员。
type ContentsStub = Pick<WebContents, "isDestroyed" | "isDevToolsOpened" | "openDevTools" | "closeDevTools"> & {
    destroyed: boolean;
    opened: boolean;
    calls: unknown[];
};

// 被测函数要求完整的 WebContents；用例只实现被调用的成员，因此在工厂内做一次显式转换。
const createContents = ({destroyed = false, opened = false} = {}): ContentsStub & WebContents => ({
    destroyed,
    opened,
    calls: [],
    isDestroyed() { return this.destroyed; },
    isDevToolsOpened() { return this.opened; },
    openDevTools(options) { this.opened = true; this.calls.push(["open", options]); },
    closeDevTools() { this.opened = false; this.calls.push(["close"]); },
}) as unknown as ContentsStub & WebContents;

test("Windows opens docked at the bottom", () => {
    const contents = createContents();
    openDevTools(contents, "win32");
    assert.deepEqual(contents.calls, [["open", {mode: "bottom"}]]);
});

test("other platforms keep the last dock position", () => {
    for (const platform of ["linux", "darwin"] as const) {
        const contents = createContents();
        openDevTools(contents, platform);
        assert.deepEqual(contents.calls, [["open", undefined]]);
    }
});

test("explicit dock modes and activation/title options are preserved on every platform", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
        for (const mode of ["left", "right", "bottom", "undocked", "detach"]) {
            const contents = createContents();
            const options = Object.freeze({mode, activate: false, title: "Custom DevTools", ignored: true});
            openDevTools(contents, platform, options);
            assert.deepEqual(contents.calls, [["open", {mode, activate: false, title: "Custom DevTools"}]]);
        }
    }
});

test("activation and title options retain the platform default dock mode", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
        const contents = createContents();
        openDevTools(contents, platform, {activate: true, title: ""});
        assert.deepEqual(contents.calls, [["open", {
            ...(platform === "win32" ? {mode: "bottom"} : {}), activate: true, title: "",
        }]]);
    }
});

test("invalid options are ignored without losing platform defaults", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
        // 这些值故意违反签名：用例验证运行期校验不依赖类型系统。
        const invalidOptions: unknown[] = [null, false, "right", {},
            {mode: "invalid", activate: "false", title: 123, ignored: true}];
        for (const options of invalidOptions) {
            const contents = createContents();
            openDevTools(contents, platform, options as Parameters<typeof openDevTools>[2]);
            assert.deepEqual(contents.calls, [["open", platform === "win32" ? {mode: "bottom"} : undefined]]);
        }
    }
});

test("the IPC payload forwards its dock options unchanged", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
        const contents = createContents();
        openDevTools(contents, platform, {mode: "detach", activate: false, title: "IPC DevTools"});
        assert.deepEqual(contents.calls, [["open", {mode: "detach", activate: false, title: "IPC DevTools"}]]);
    }
});

test("toggling closes an open developer tools panel", () => {
    const contents = createContents({opened: true});
    toggleDevTools(contents, "win32");
    assert.deepEqual(contents.calls, [["close"]]);
});

test("toggling opens a closed developer tools panel at the platform default", () => {
    const bottom = createContents();
    toggleDevTools(bottom, "win32");
    assert.deepEqual(bottom.calls, [["open", {mode: "bottom"}]]);
    const last = createContents();
    toggleDevTools(last, "darwin");
    assert.deepEqual(last.calls, [["open", undefined]]);
});

test("missing and destroyed contents are ignored", () => {
    for (const contents of [createContents({destroyed: true}), undefined, null]) {
        openDevTools(contents, "win32");
        toggleDevTools(contents, "win32");
    }
    const destroyed = createContents({destroyed: true});
    assert.deepEqual(destroyed.calls, []);
});

// 主窗口与设置窗口共用同一条快捷键：macOS 是 Cmd+Alt+I，其他平台是 Ctrl+Shift+I。
test("DevTools shortcut differs per platform and rejects extra modifiers", () => {
    const mac = {meta: true, alt: true, control: false, shift: false};
    const others = {meta: false, alt: false, control: true, shift: true};
    assert.equal(isDevToolsShortcut({...mac, key: "i"} as never, "darwin"), true);
    assert.equal(isDevToolsShortcut({...others, key: "i"} as never, "win32"), true);
    assert.equal(isDevToolsShortcut({...others, key: "i"} as never, "linux"), true);
    // 跨平台组合不生效：
    assert.equal(isDevToolsShortcut({...others, key: "i"} as never, "darwin"), false);
    assert.equal(isDevToolsShortcut({...mac, key: "i"} as never, "win32"), false);
    // 多按一个修饰键就不算：
    assert.equal(isDevToolsShortcut({...mac, control: true, key: "i"} as never, "darwin"), false);
    assert.equal(isDevToolsShortcut({...others, alt: true, key: "i"} as never, "win32"), false);
});

test("DevTools shortcut falls back to the physical key and tolerates a missing key", () => {
    const others = {meta: false, alt: false, control: true, shift: true};
    // 非拉丁布局下字符不是 i，但物理键仍是 KeyI。
    assert.equal(isDevToolsShortcut({...others, key: "ф", code: "KeyI"} as never, "win32"), true);
    // key 缺失不得抛错，只按 code 判断。
    assert.equal(isDevToolsShortcut({...others, code: "KeyI"} as never, "win32"), true);
    assert.equal(isDevToolsShortcut({...others, code: "KeyJ"} as never, "win32"), false);
    assert.equal(isDevToolsShortcut({...others} as never, "win32"), false);
});

