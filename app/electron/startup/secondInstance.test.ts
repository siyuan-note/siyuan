// 第二实例（`startup/secondInstance.ts`）：事件可能早于 app 就绪到达，那时建不了窗口，因此必须入队后就绪重放。
import {test} from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {EventEmitter} from "node:events";
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

test("a normal launch from a Markdown-only process restores workspace startup checks", async t => {
    for (const scenario of ["existing", "explicit", "environment", "first", "missing", "crash"] as const) {
        await t.test(scenario, async (t: any) => {
            runtime.resetRuntimeState();
            resetElectronStub();
            const savedPaths = {...runtime.paths};
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-markdown-main-launch-"));
            const workspace = path.join(directory, "workspace");
            fs.mkdirSync(workspace);
            const missing = path.join(directory, "missing");
            if (scenario !== "first") fs.writeFileSync(path.join(directory, "workspace.json"),
                JSON.stringify([workspace, ...(scenario === "missing" ? [missing] : [])]));
            const environmentWorkspace = process.env.SIYUAN_WORKSPACE_PATH;
            delete process.env.SIYUAN_WORKSPACE_PATH;
            if (scenario === "environment") process.env.SIYUAN_WORKSPACE_PATH = path.join(directory, "environment");
            Object.assign(runtime.paths, {confDir: directory, assetsDir: directory,
                appCrashMarkerPath: path.join(directory, "app.crash.json"), appCrashLogPath: path.join(directory, "app.crash.log")});
            if (scenario === "crash") fs.writeFileSync(runtime.paths.appCrashMarkerPath,
                JSON.stringify({reason: "crashed", workspaceDir: workspace}));
            runtime.state.markdown.startup = true;
            runtime.setStartupSnapshot({...runtime.state.startup, firstOpen: scenario === "first"});
            const snapshot = runtime.state.startup;
            const windows = [];
            const listeners = new Map();
            class BrowserWindow extends EventEmitter {
                destroyed = false;
                webContents = {id: 99};
                file: string;
                query: Record<string, string>;
                shown = 0;
                constructor() {super(); windows.push(this);}
                loadFile(file, options) {this.file = file; this.query = options.query;}
                show() {this.shown++;}
                focus() {}
                isDestroyed() {return this.destroyed;}
                isMinimized() {return false;}
                destroy() {this.destroyed = true; this.emit("closed");}
            }
            mockElectron(t, {BrowserWindow: BrowserWindow as unknown as typeof import("electron").BrowserWindow,
                ipcMain: {on: (channel, callback) => listeners.set(channel, callback),
                    removeListener: (channel, callback) => {if (listeners.get(channel) === callback) listeners.delete(channel);}} as unknown as import("electron").IpcMain,
                screen: {getPrimaryDisplay: () => ({size: {width: 1000}, workAreaSize: {height: 800}})}});
            t.after(() => {
                windows.forEach(window => window.destroy());
                if (environmentWorkspace === undefined) delete process.env.SIYUAN_WORKSPACE_PATH;
                else process.env.SIYUAN_WORKSPACE_PATH = environmentWorkspace;
                Object.assign(runtime.paths, savedPaths);
                runtime.resetRuntimeState();
                resetElectronStub();
                assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
                fs.rmSync(directory, {recursive: true, force: true});
            });
            const requests: Parameters<InitKernel>[0][] = [];
            const opened = [];
            const {queueSecondInstance, startSecondInstance} = secondInstance();
            startSecondInstance({initKernel: async request => {requests.push(request); return 6806;},
                initMainWindow: port => {opened.push(port);}});
            const argv = ["siyuan", ...(scenario === "explicit" ? ["--workspace=" + workspace] : [])];
            queueSecondInstance({} as ElectronEvent, argv);
            await Promise.resolve();
            assert.equal(runtime.state.startup, snapshot, "deferred workspace checks preserve the initial startup snapshot");
            assert.equal(runtime.state.markdown.startup, true);
            if (scenario === "existing" || scenario === "explicit" || scenario === "environment") {
                assert.equal(requests.length, 1);
                assert.equal(requests[0].workspace, scenario === "environment" ? process.env.SIYUAN_WORKSPACE_PATH : workspace);
                assert.deepEqual(opened, [6806]);
                assert.equal(windows.length, 0);
            } else {
                assert.equal(requests.length, 0);
                assert.equal(windows.length, 1);
                assert.equal(path.basename(windows[0].file), scenario === "first" ? "init.html" : "workspace.html");
                if (scenario === "missing") assert.equal(windows[0].query.missing, missing);
                if (scenario === "crash") {
                    assert.equal(windows[0].query.crash, "1");
                    assert.equal(windows[0].query.workspace, workspace);
                    assert.ok(fs.existsSync(runtime.paths.appCrashMarkerPath));
                }
                queueSecondInstance({} as ElectronEvent, argv);
                assert.equal(windows.length, 1, "repeated normal launches focus the existing workspace selection");
                windows[0].destroy();
                assert.equal(listeners.size, 0, "closing the selection releases its request handler");
                queueSecondInstance({} as ElectronEvent, argv);
                assert.equal(windows.length, 2, "a canceled workspace selection can be reopened");
                const choose = listeners.values().next().value;
                choose({sender: {}}, {workspace, lang: "en"});
                assert.equal(requests.length, 0, "a different window cannot complete this workspace selection");
                choose({sender: windows[1].webContents}, {workspace, lang: "en", safeMode: scenario === "crash"});
                await Promise.resolve();
                assert.equal(requests.length, 1);
                assert.equal(requests[0].workspace, workspace);
                assert.equal(requests[0].safeMode, scenario === "crash");
                assert.deepEqual(opened, [6806]);
                assert.equal(listeners.size, 0);
                if (scenario === "crash") assert.equal(fs.existsSync(runtime.paths.appCrashMarkerPath), false);
            }
        });
    }
});
