// 桌面端启动顺序（`startup/bootstrap.ts`）：就绪前的条件必须在建窗与拉内核之前确定。
// 这里用 Electron 替身真的跑一遍 `bootstrap()`，因此不依赖源码文本的排版。
import {test} from "node:test";
import type {App, IpcMain, Session} from "electron";
import * as runtime from "../shared/runtime";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const actualPlatform = process.platform;
const actualArgv = process.argv;

// `bootstrap()` 会调用全部被替身的成员，因此替身需要覆盖它真正用到的那些。
type BootstrapStubOptions = {
    lockAcquired?: boolean;
    linuxInputMethodEnabled?: boolean;
    home?: string;
};

const createBootstrapFixture = (t: any, {
    lockAcquired = true, linuxInputMethodEnabled = false, home,
}: BootstrapStubOptions = {}) => {
    const order: string[] = [];
    const root = home ?? fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-bootstrap-"));
    // 配置目录预先建好：首次启动时它还不存在，日志写入会失败。
    const confDir = path.join(root, ".config", "siyuan");
    fs.mkdirSync(confDir, {recursive: true});
    if (linuxInputMethodEnabled) {
        fs.writeFileSync(path.join(confDir, "linux-input-method.json"), '{"enabled":true}');
    }

    const relaunch: unknown[] = [];
    const exits: unknown[] = [];
    const quitLogs: string[] = [];
    const app = {
        getPath: (name: string) => name === "home" ? root : path.join(root, name),
        getAppPath: () => path.join(root, "app"),
        getVersion: () => "9.9.9",
        getName: () => "SiYuan",
        isReady: () => true,
        isPackaged: false,
        commandLine: {hasSwitch: () => false, getSwitchValue: () => "", appendSwitch: () => {}},
        setPath: () => order.push("setPath"),
        setAppUserModelId: () => order.push("setAppUserModelId"),
        requestSingleInstanceLock: () => { order.push("requestSingleInstanceLock"); return lockAcquired; },
        quit: () => {
            order.push("quit");
            quitLogs.push(fs.readFileSync(path.join(confDir, "app.log"), "utf8"));
        },
        exit: (code?: number) => { order.push("app.exit"); exits.push(code); },
        relaunch: (options: unknown) => { order.push("relaunch"); relaunch.push(options); },
        setAsDefaultProtocolClient: () => { order.push("registerProtocol"); return true; },
        on: () => {}, once: () => {}, removeListener: () => {}, off: () => {},
        // 就绪回调永不触发：本用例只覆盖就绪前的顺序，不进入建窗与拉内核。
        whenReady: () => { order.push("whenReady"); return new Promise(() => {}); },
    };
    const ipcMain = {
        on: () => {}, once: () => {}, off: () => {}, removeListener: () => {},
        handle: () => {}, handleOnce: () => {}, removeHandler: () => {},
    };

    resetElectronStub();
    mockElectron(t, {
        app: app as unknown as App,
        ipcMain: ipcMain as unknown as IpcMain,
        session: {defaultSession: {setCertificateVerifyProc() {}}} as unknown as Session,
        net: {fetch: async () => ({json: async () => ({})}), isOnline: () => true} as unknown as Record<string, unknown>,
        // Markdown 自定义协议在 ready 之前登记，替身记录调用顺序即可。
        protocol: {registerSchemesAsPrivileged: () => order.push("markdownSchemes")},
        screen: {getPrimaryDisplay: () => ({size: {width: 1000, height: 800},
            workAreaSize: {width: 1000, height: 800}})} as unknown as Record<string, unknown>,
    });
    // 兼容模式重启只在 Linux 上有意义，用例统一按 Linux 跑，避免受运行机器影响。
    Object.defineProperty(process, "platform", {value: "linux", configurable: true});
    process.argv = [...actualArgv];
    t.mock.module("@electron/remote/main", {exports: {initialize() {}, enable() {}}});
    t.after(() => {
        Object.defineProperty(process, "platform", {value: actualPlatform, configurable: true});
        process.argv = actualArgv;
        resetElectronStub();
        fs.rmSync(root, {recursive: true, force: true});
    });

    return {order, relaunch, exits, quitLogs, confDir, root};
};

const runBootstrap = async (): Promise<void> => {
    // 必须用动态 import：静态 import 会提升到替身安装之前。类型系统据此能解析到被测模块的导出。
    const {bootstrap} = await import("./bootstrap.js");
    bootstrap();
};

test("startup conditions are decided before the single instance lock and the ready callback", async (t) => {
    const {order} = createBootstrapFixture(t);
    await runBootstrap();
    const index = (name: string) => {
        const position = order.indexOf(name);
        assert.notEqual(position, -1, "缺少 " + name + "，实际顺序: " + order.join(" > "));
        return position;
    };
    // 进程级身份早于取锁：另一个实例已经在跑时也会先设置好 userData 目录。
    assert.ok(index("setPath") < index("requestSingleInstanceLock"));
    // 协议注册与就绪回调都在取锁成功之后。
    assert.ok(index("requestSingleInstanceLock") < index("registerProtocol"));
    assert.ok(index("requestSingleInstanceLock") < index("whenReady"));
});

test("compatibility relaunch happens before the lock is claimed", async (t) => {
    const {order, relaunch, exits} = createBootstrapFixture(t, {linuxInputMethodEnabled: true});
    await runBootstrap();
    // 重启请求与退出发生在取锁之前，因此不会留下持锁或已建窗的进程。
    assert.equal(relaunch.length, 1);
    assert.deepEqual(exits, [0]);
    assert.ok(order.indexOf("relaunch") < order.indexOf("requestSingleInstanceLock"),
        "兼容模式重启必须早于单实例锁，实际顺序: " + order.join(" > "));
});

test("a failed instance lock logs the reason and launch arguments before quitting", async (t) => {
    const {order, quitLogs} = createBootstrapFixture(t, {lockAcquired: false});
    const argumentsAtLaunch = [...process.argv, "siyuan://blocks/20261106120000-abcdefg", "--hidden"];
    process.argv = argumentsAtLaunch.slice();
    await runBootstrap();
    assert.equal(order.filter(value => value === "quit").length, 1);
    assert.equal(quitLogs.length, 1);
    assert.ok(quitLogs[0].includes("single instance lock not acquired, quitting; command line args " + JSON.stringify(argumentsAtLaunch)));
    assert.deepEqual(process.argv, argumentsAtLaunch);
    assert.equal(order.includes("whenReady"), false);
    assert.equal(order.includes("registerProtocol"), false);
});

test("startup does not create windows itself", async (t) => {
    const {order} = createBootstrapFixture(t);
    await runBootstrap();
    // 建窗全部下沉到模块；就绪回调未触发时不可能出现任何窗口创建。
    assert.equal(order.includes("newBrowserWindow"), false);
    assert.equal(runtime.state.startup.firstOpen, true);
});
