// 独立 Markdown 编辑器的接线（`startup/markdownEditors.ts`）：队列串行、启动判定与进程退出条件。
import {test} from "node:test";
import * as runtime from "../shared/runtime";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import type {MarkdownWindows} from "../markdown/windows";
const assert = require("node:assert/strict");

// 被测模块在测试内 require：它在加载时从 electron 替身取成员。
const markdownEditors = () => require("./markdownEditors");

// 只实现接线实际访问的成员，其余窗口能力由用例按需覆盖。
const managerStub = (overrides: Partial<MarkdownWindows> = {}): MarkdownWindows => ({
    open: async () => undefined,
    handleLaunch: async () => true,
    hasWindows: () => false,
    hasPendingWork: () => false,
    owns: () => false,
    focus: () => undefined,
    prepareQuit: async () => true,
    closeAll: async () => true,
    cancelQuit: () => undefined,
    ...overrides,
});

const setup = (t: any, windows?: MarkdownWindows) => {
    runtime.resetRuntimeState();
    resetElectronStub();
    mockElectron(t, {});
    const editors = markdownEditors();
    runtime.state.markdown.windows = windows ?? managerStub();
    t.after(() => {
        runtime.resetRuntimeState();
        resetElectronStub();
    });
    return editors;
};

test("queued file launches run one at a time and the process quits only after the queue drains", async (t: any) => {
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const editors = setup(t, managerStub({
        handleLaunch: async argv => {
            events.push(argv[0]);
            if (argv[0].includes("first")) {
                await new Promise<void>(resolve => { releaseFirst = resolve; });
            }
            return true;
        },
    }));
    const quits: string[] = [];
    (require("electron").app as {quit: () => void}).quit = () => quits.push("quit");

    // 启动判定为独立入口且队列非空，排空后没有窗口就必须退出。
    runtime.state.markdown.startup = true;
    runtime.state.markdown.pendingLaunches.push({argv: ["--markdown=first.md"], cwd: "C:\\notes"});
    editors.drainMarkdownLaunches();
    editors.routeMarkdownLaunch(["--markdown=second.md"]);

    // 第一项未完成时第二项不能开始。
    assert.deepEqual(events, ["--markdown=first.md"]);
    assert.deepEqual(quits, []);

    (releaseFirst as () => void)();
    await runtime.state.markdown.launchTask;
    assert.deepEqual(events, ["--markdown=first.md", "--markdown=second.md"]);
    assert.deepEqual(quits, ["quit"]);
});

test("a launch request that carries no file is not routed to the editor", async (t: any) => {
    const launches: string[][] = [];
    const editors = setup(t, managerStub({
        handleLaunch: async argv => { launches.push(argv); return true; },
    }));
    assert.equal(editors.routeMarkdownLaunch(["--workspace=/notes"]), false);
    assert.deepEqual(launches, []);
    // `--markdown` 不带路径表示空白编辑器，仍然交给窗口管理器。
    assert.equal(editors.routeMarkdownLaunch(["--markdown"]), true);
    await runtime.state.markdown.launchTask;
    assert.deepEqual(launches, [["--markdown"]]);
    assert.deepEqual(runtime.state.markdown.pendingLaunches, []);
});

test("startup detection follows the file entry rather than any positional path", (t: any) => {
    const editors = setup(t);
    editors.detectMarkdownStartup(["notes.md"]);
    assert.equal(runtime.state.markdown.startup, true);
    runtime.state.markdown.startup = false;
    // 工作空间参数里的 .md 不构成文件入口。
    editors.detectMarkdownStartup(["--workspace=/notes.md"]);
    assert.equal(runtime.state.markdown.startup, false);
});

test("quit coordination degrades to a no-op before the editor runtime exists", async (t: any) => {
    const editors = setup(t);
    runtime.state.markdown.lifecycle = undefined;
    assert.equal(await editors.prepareMarkdownQuit("update"), true);
    assert.equal(await editors.closeMarkdownEditors(), true);
    assert.equal(editors.hasPendingMarkdownWork(), false);
    assert.equal(editors.ownsMarkdownWindow({id: 1}), false);
    editors.cancelMarkdownQuit();
    editors.openMarkdownEditor();
});

test("closing the last editor window quits only when the launch left nothing behind", async (t: any) => {
    const quits: string[] = [];
    const editors = setup(t);
    (require("electron").app as {quit: () => void}).quit = () => quits.push("quit");

    // 有工作空间在内时不能因为 Markdown 窗口关闭而退出。
    runtime.state.markdown.startup = false;
    runtime.state.markdown.pendingLaunches.push({argv: ["--markdown=a.md"], cwd: process.cwd()});
    editors.drainMarkdownLaunches();
    await runtime.state.markdown.launchTask;
    assert.deepEqual(quits, []);

    // 独立入口且窗口已关闭：排空后退出。
    runtime.state.markdown.startup = true;
    runtime.state.markdown.pendingLaunches.push({argv: ["--markdown=b.md"], cwd: process.cwd()});
    editors.drainMarkdownLaunches();
    await runtime.state.markdown.launchTask;
    assert.deepEqual(quits, ["quit"]);
});
