// 第二实例（`startup/secondInstance.ts`）：事件可能早于 app 就绪到达，那时建不了窗口，因此必须入队后就绪重放。
import {test} from "node:test";
import * as runtime from "../shared/runtime";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import type {Event as ElectronEvent} from "electron";
import type {InitKernel} from "../shared/types";
const assert = require("node:assert/strict");

// 被测模块在测试内 require：它在加载时从 electron 替身取成员。
const secondInstance = () => require("./secondInstance");

test("second instance events are replayed in order once startup handlers arrive", (t: any) => {
    runtime.resetRuntimeState();
    resetElectronStub();
    mockElectron(t, {});
    const {queueSecondInstance, startSecondInstance} = secondInstance();
    const event = {} as ElectronEvent;

    const started: (string | undefined)[] = [];
    const initKernel: InitKernel = (request) => {
        started.push(request.workspace);
        return Promise.resolve(6806);
    };

    // 就绪前：只入队，不建窗也不拉内核。
    queueSecondInstance(event, ["siyuan", "--workspace=/first"]);
    queueSecondInstance(event, ["siyuan", "--workspace=/second"]);
    assert.deepEqual(started, []);

    // 就绪后接管：积压的事件按到达顺序重放。
    startSecondInstance({initKernel, initMainWindow: () => undefined});
    assert.deepEqual(started, ["/first", "/second"]);

    // 之后到达的事件不再排队，直接处理。
    queueSecondInstance(event, ["siyuan", "--workspace=/third"]);
    assert.deepEqual(started, ["/first", "/second", "/third"]);
});

test("a file request is routed to the editor before remote mode rejects the instance", (t: any) => {
    runtime.resetRuntimeState();
    resetElectronStub();
    const launches: {argv: string[]; cwd: string}[] = [];
    mockElectron(t, {});
    // 窗口管理器只记录收到的启动参数，本用例只关心路由是否发生。
    runtime.state.markdown.windows = {
        open: async () => undefined,
        handleLaunch: async (argv: string[], cwd: string) => { launches.push({argv, cwd}); return true; },
        hasWindows: () => false, hasPendingWork: () => false, owns: () => false, focus: () => undefined,
        prepareQuit: async () => true, closeAll: async () => true, cancelQuit: () => undefined,
    };
    // 远端参数无效时，文件请求仍然要先交给 Markdown 编辑器。
    runtime.state.startup = Object.freeze({
        ...runtime.state.startup, remoteKernelArgError: {code: "ERR"}, firstOpen: false,
        openAsHidden: false, initialDeepLink: "", lastWorkspacePath: "", lastWorkspaceMissing: false,
        missingWorkspacePath: "", availableWorkspaces: [],
    });
    t.after(() => runtime.resetRuntimeState());

    const {queueSecondInstance, startSecondInstance} = secondInstance();
    const started: string[] = [];
    startSecondInstance({
        initKernel: (request) => { started.push(request.workspace ?? ""); return Promise.resolve(6806); },
        initMainWindow: () => undefined,
    });
    queueSecondInstance({} as ElectronEvent, ["siyuan", "relative.md"], "D:\\sender");
    assert.deepEqual(launches, [{argv: ["siyuan", "relative.md"], cwd: "D:\\sender"}]);
    // 路由给编辑器后不再按工作空间参数处理。
    assert.deepEqual(started, []);
});
