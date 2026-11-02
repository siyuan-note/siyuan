// 工作空间退出（`window/appExit.ts`）：独立 Markdown 窗口不属于工作空间，不能随最后一个工作空间一起销毁。
import {test} from "node:test";
import {paths, resetRuntimeState, state} from "../shared/runtime";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
const assert = require("node:assert/strict");

const appExit = () => require("./appExit");

type StubWindow = {
    id: number;
    destroyed?: boolean;
    webContents: {id: number; getURL: () => string; isDevToolsOpened: () => boolean};
    isDestroyed: () => boolean;
    destroy: () => void;
    getNormalBounds: () => Record<string, unknown>;
    isMaximized: () => boolean;
    isFullScreen: () => boolean;
};

const makeWindow = (id: number, url: string): StubWindow => ({
    id,
    webContents: {id, getURL: () => url, isDevToolsOpened: () => false},
    isDestroyed() { return !!this.destroyed; },
    destroy() { this.destroyed = true; },
    getNormalBounds: () => ({}),
    isMaximized: () => false,
    isFullScreen: () => false,
});

const setup = (t: any, windows: StubWindow[], markdownLifecycle?: {hasPendingWork: () => boolean}) => {
    resetRuntimeState();
    resetElectronStub();
    const state_: {appExits: number; relaunches: number} = {appExits: 0, relaunches: 0};
    mockElectron(t, {
        BrowserWindow: {getAllWindows: () => windows} as any,
        app: {
            exit: () => { state_.appExits++; },
            relaunch: () => { state_.relaunches++; },
        } as any,
        globalShortcut: {unregisterAll: () => undefined} as any,
    });
    paths.windowStatePath = require("node:path").join(require("node:os").tmpdir(), "siyuan-window-state.json");
    if (markdownLifecycle) {
        state.markdown.lifecycle = markdownLifecycle as any;
    }
    t.after(() => {
        resetRuntimeState();
        resetElectronStub();
    });
    return state_;
};

test("a crash window keeps independent Markdown windows while closing the workspace windows", (t: any) => {
    const main = makeWindow(1, "https://127.0.0.1:6806/stage/build/app/");
    const markdown = makeWindow(2, "siyuan-markdown://session/index.html");
    const error = makeWindow(3, "file:///error.html");
    const calls = setup(t, [main, markdown, error], {hasPendingWork: () => true});
    state.markdown.windows = {owns: contents => contents === markdown.webContents} as any;
    const workspace = {browserWindow: main, kernelTarget: {origin: "https://127.0.0.1:6806"}, ownsKernel: true} as any;
    state.workspaces.push(workspace);

    appExit().exitWorkspace(workspace, 3);

    assert.equal(main.destroyed, true);
    // Markdown 与错误窗口都不属于这次工作空间退出。
    assert.equal(markdown.destroyed, undefined);
    assert.equal(error.destroyed, undefined);
    assert.equal(calls.appExits, 0);
    assert.equal(state.workspaces.length, 0);
});

test("pending Markdown work keeps the process alive after the last workspace closes", (t: any) => {
    const main = makeWindow(1, "https://127.0.0.1:6806/stage/build/app/");
    const calls = setup(t, [main], {hasPendingWork: () => true});
    state.markdown.windows = {owns: () => false} as any;
    const workspace = {browserWindow: main, kernelTarget: {origin: "https://127.0.0.1:6806"}, ownsKernel: true} as any;
    state.workspaces.push(workspace);

    appExit().exitWorkspace(workspace);

    assert.equal(main.destroyed, true);
    assert.equal(calls.appExits, 0);
});

test("without Markdown work the last workspace exit still closes the process", (t: any) => {
    const main = makeWindow(1, "https://127.0.0.1:6806/stage/build/app/");
    const calls = setup(t, [main], {hasPendingWork: () => false});
    state.markdown.windows = {owns: () => false} as any;
    const workspace = {browserWindow: main, kernelTarget: {origin: "https://127.0.0.1:6806"}, ownsKernel: true} as any;
    state.workspaces.push(workspace);

    appExit().exitWorkspace(workspace);

    // 没有 Markdown 未完成工作时直接退出进程，窗口不需要逐个销毁。
    assert.equal(main.destroyed, undefined);
    assert.equal(calls.appExits, 1);
});
