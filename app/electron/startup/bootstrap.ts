// 桌面端启动流程：先定启动条件，再装配能力，最后在 app 就绪后开窗。
import * as fs from "node:fs";
import * as path from "node:path";
import {app, dialog, session} from "electron";
// @electron/remote 由 Electron 主进程注入，模块本身只有命名空间导出。
import * as remote from "@electron/remote/main";
import {createConsole, createWriteLog} from "../shared/logging";
import {toError} from "../shared/errors";
import {getArgFrom} from "../shared/argv";
import {findDeepLink} from "../shared/builtinArgs";
import {readAppCrashInfo} from "../shared/crashHistory";
import {applyStartupSwitches, forwardCommandLineSwitches, rejectUnsafeRemoteSwitches} from "./startupSwitches";
import {createKernelBoot} from "../kernel/kernelBoot";
import * as bootWindows from "../window/bootWindows";
import {createMainWindow} from "../window/mainWindow";
import {setStartupApplicationMenu} from "../window/appMenu";
import {configureRuntime, paths, setStartupSnapshot, state, writeLog} from "../shared/runtime";
import {getWindowPathname} from "../window/windowNavigation";
import {getInitializedWindows, getWindowKernelTarget} from "../window/windowRegistry";
import {createNotebookSystemLock, prepareNotebookSystemLock} from "../kernel/notebookSystemLock";
import {createSettingsTaskBridge} from "../window/settingsTaskBridge";
import {createSettingsWindows} from "../window/settingsWindows";
import {initializeAccessibility} from "./accessibility";
import {initializeLinuxInputMethod} from "./linuxInputMethod";
import {resolveStartupBranch, runStartupBranch} from "./startupBranches";
import {installKernelRequestLog} from "../kernel/kernelRequestLog";
import {createConnectionRuntime} from "../remote/connectionRuntime";
import {registerProtocolClient} from "./protocolClient";
import {emptyLastWorkspaceProbe, readLastWorkspace} from "./lastWorkspace";
import {
    createRemoteKernelTarget, shouldTrustLocalKernelCertificate,
} from "../remote/remoteKernel";
import {registerDesktopIpc} from "../ipc/register";
import {registerAppLifecycle, registerRuntimeHandlers} from "./appLifecycle";
import {queueSecondInstance, startSecondInstance} from "./secondInstance";
import {exitApp} from "../window/appExit";
import {showWindow} from "../window/windowVisibility";
import type {InitMainWindow, KernelTarget, Workspace} from "../shared/types";

// 日志同时写终端与工作空间文件，其余模块通过 runtime 共享同一实例。
const console = createConsole();

// 启动入口：就绪前定条件并冻结启动快照，就绪后由 startAfterReady 接线开窗。
const bootstrap = (): void => {
    // ===== 就绪前：确定启动条件 =====
    process.noAsar = true;
    installRuntime();

    // 兼容模式会原地剔除受管开关，且必须早于单实例锁、建窗与内核启动。
    const launchArguments = process.argv.slice();
    initializeLinuxInputMethod({
        platform: process.platform,
        settingFile: paths.linuxInputMethodSettingPath,
        launchArguments,
        env: process.env,
    });
    // 进程身份里的 userData 决定单实例锁的落点，必须早于取锁。
    initializeProcessIdentity();

    if (!app.requestSingleInstanceLock()) {
        app.quit();
        return;
    }
    // 取锁成功即登记：启动能力装配完成前到达的第二实例先入队，就绪后按序重放。
    app.on("second-instance", queueSecondInstance);

    // 开发模式首次启动连接该端口上已在运行的内核；拉起的进程使用实际分配到的端口。
    // 必须在启动页分配端口之前定下，开发内核的端口分配会直接沿用它。
    state.kernel.port = 6806;

    // 本阶段及其后的解析一律以 launchArguments 为准。
    const remoteKernel = resolveRemoteKernel(launchArguments);
    const remoteMode = !!remoteKernel.target;
    // 命令行只解析一次深链；本地内核在窗口就绪时转交，远端内核先暂存。
    const initialDeepLink = findDeepLink(launchArguments) || "";
    if (remoteMode && !remoteKernel.error && initialDeepLink) {
        state.pendingRemoteOpenURLs.push(initialDeepLink);
    }

    // 协议注册与 Chromium 开关决定后续所有窗口，必须在建窗之前完成。
    registerProtocolClient({
        isDevEnv: paths.isDevEnv, defaultApp: !!process.defaultApp, argv: launchArguments,
    });
    applyStartupSwitches(remoteMode);
    writeLog("app is packaged [" + app.isPackaged + "], command line args [" + launchArguments.join(", ") + "]");
    // 桌面端允许通过命令行追加 Chromium 启动参数，这些开关一并转交，并回传本次是否隐藏启动
    // https://github.com/siyuan-note/siyuan/issues/9696
    const openAsHidden = forwardCommandLineSwitches({
        argv: launchArguments,
        packaged: app.isPackaged,
        remote: remoteMode,
    });
    // 辅助功能配置对本机所有工作空间生效，必须在建窗前应用。
    initializeAccessibility(paths.accessibilitySettingPath);

    // 首次启动标志与上次工作空间都只看一次磁盘，结果直接进启动快照。
    const firstOpen = ensureConfigDirectory(paths.confDir, remoteMode);
    // 上次打开的工作空间既用于崩溃恢复，也用于提示目录已丢失；显式指定 --workspace 时跳过。
    const lastWorkspace = !remoteMode && !firstOpen && !getArgFrom(launchArguments, "--workspace") ?
        readLastWorkspace(paths.confDir, writeLog) : emptyLastWorkspaceProbe();
    setStartupSnapshot({
        remoteKernelTarget: remoteKernel.target, remoteKernelArgError: remoteKernel.error,
        openAsHidden, firstOpen, initialDeepLink, ...lastWorkspace,
    });

    // ===== 装配：建窗之前必须就位的能力 =====
    createSettingsTaskBridge();
    const initMainWindow = createMainWindow();
    const settingsWindowPolicy = createSettingsWindows();
    // 进程级事件在建窗之前登记：系统深链可能在启动过程中到达；第二实例在取锁时已开始入队。
    registerAppLifecycle({initMainWindow, settingsWindowPolicy});
    // 内核编排与系统锁只在就绪后使用，由 startAfterReady 自行创建。
    void app.whenReady().then(() => startAfterReady(initMainWindow, launchArguments));
};

// 全部路径与日志实例一次性写入 runtime；之后的调用方从 paths 读取。
const installRuntime = (): void => {
    const confDir = path.join(app.getPath("home"), ".config", "siyuan");
    configureRuntime({
        appDir: path.dirname(app.getAppPath()), appVer: app.getVersion(), confDir,
        windowStatePath: path.join(confDir, "windowState.json"),
        linuxInputMethodSettingPath: path.join(confDir, "linux-input-method.json"),
        accessibilitySettingPath: path.join(confDir, "accessibility.json"),
        appCrashLogPath: path.join(confDir, "app.crash.log"),
        appCrashMarkerPath: path.join(confDir, "app.crash.json"),
        // webpack 把主进程打成一个 electron-dist/main.js，静态资源也复制到它旁边，因此这里取运行时的 __dirname。
        assetsDir: path.join(__dirname, "static"),
        isDevEnv: process.env.NODE_ENV === "development",
        simulateRosetta: process.argv.includes("--simulate-rosetta"),
        writeLog: createWriteLog(console, confDir), console,
    });
};

// 远端内核参数与不安全开关在启动早期解析，两者一起交给启动分支；两项皆空表示按本地内核启动。
const resolveRemoteKernel = (launchArguments: string[]): {
    target?: KernelTarget;
    error?: {code?: string; message?: string};
} => {
    const arg = getArgFrom(launchArguments, "--remote");
    if (arg === undefined) {
        return {};
    }
    let target: KernelTarget;
    try {
        target = createRemoteKernelTarget(arg, launchArguments);
    } catch (error) {
        return {error: toError(error)};
    }
    // 远端模式下拒绝会让本地内核暴露给对端的 Chromium 开关；目标仍保留，启动分支按错误优先处理。
    const unsafeSwitchError = rejectUnsafeRemoteSwitches(launchArguments);
    return {target, error: unsafeSwitchError};
};

const initializeProcessIdentity = (): void => {
    remote.initialize();
    // userData 使用独立的 SiYuan-Electron 目录；getPath("userData") 会先创建空的 SiYuan 目录，因此从 appData 推算
    // https://github.com/siyuan-note/siyuan/issues/3349
    app.setPath("userData", path.join(app.getPath("appData"), app.getName() + "-Electron"));
    if (process.platform === "win32") {
        // Windows 需要设置 AppUserModelId 才能正确显示应用名称和应用图标 https://github.com/siyuan-note/siyuan/issues/17022
        app.setAppUserModelId("org.b3log.siyuan");
    }
};

// 没有 workspace.json 说明还没打开过工作空间；配置目录在本阶段补齐，写入失败时提示后退出。
const ensureConfigDirectory = (confDir: string, remoteMode: boolean): boolean => {
    let firstOpen = false;
    try {
        firstOpen = !remoteMode && !fs.existsSync(path.join(confDir, "workspace.json"));
        if (!fs.existsSync(confDir)) {
            fs.mkdirSync(confDir, {mode: 0o755, recursive: true});
        }
    } catch (e) {
        console.error(e);
        writeLog("create config directory failed: " + toError(e).stack);
        dialog.showErrorBox("创建配置目录失败 Failed to create config directory", "思源需要在用户家目录下创建配置文件夹（~/.config/siyuan），请确保该路径具有写入权限。\n\nSiYuan needs to create a configuration folder (~/.config/siyuan) in the user's home directory. Please make sure that the path has write permissions.");
        app.exit(1);
    }
    return firstOpen;
};

// ===== 就绪后：接线并按启动分支开窗 =====

// 系统锁前让已初始化的窗口提交未保存内容；窗口按内核 origin 取。
const prepareLockedNotebookEditors = (workspace: Workspace): Promise<void> =>
    prepareNotebookSystemLock(getInitializedWindows(workspace.kernelTarget.origin));

const startAfterReady = (initMainWindow: InitMainWindow, launchArguments: string[]): void => {
    const startupStartedAt = Date.now();
    writeLog("app ready, preparing startup window");
    const appCrashInfo = readAppCrashInfo();
    writeLog("read app crash info [" + (Date.now() - startupStartedAt) + "ms since app ready]");

    // 内核编排与远端启动都从启动页取窗口与端口，因此它最先创建，其余能力之后接上。
    const {initKernel} = createKernelBoot({
        boot: bootWindows,
        // 启动页、窗口与菜单能力都由入口注入：kernel 目录不引用 window 目录。
        ui: {showWindow, exitApp},
    });
    // 笔记本系统锁只作用于已初始化的窗口；窗口查询属 window 目录，因此由入口注入。
    const notebookSystemLock = createNotebookSystemLock({prepare: prepareLockedNotebookEditors});

    // 会话策略必须早于任何页面加载：启动页一开始就向内核发请求。
    prepareSession();
    const branch = resolveStartupBranch(appCrashInfo);
    // 只有本地内核分支提前建启动页；其他分支用各自的窗口。
    const preparedBoot = branch.branch === "local-kernel" ? bootWindows.prepareLocalKernelBoot() : undefined;

    createConnectionRuntime({
        launchArguments: launchArguments.slice(1),
        getWindowPathname,
        getWindowKernelTarget,
    });
    writeLog("created connection manager [" + (Date.now() - startupStartedAt) + "ms since app ready]");

    registerDesktopIpc({initKernel, initMainWindow});
    // 第二实例的处理会建窗：就绪且启动能力到齐后接管，此前到达的事件已在队列中。
    startSecondInstance({initKernel, initMainWindow});
    // 崩溃与电源事件依赖窗口已就绪，必须在 whenReady 之后注册。
    registerRuntimeHandlers(notebookSystemLock);

    // 启动分支决定本次开哪个窗口、拉哪个内核。
    runStartupBranch({
        ...branch,
        initKernel,
        initMainWindow,
        launchArguments,
        preparedBoot,
        startupStartedAt,
    });
};

// 会话级策略：菜单、本机内核请求日志与证书校验。
const prepareSession = (): void => {
    // 前端菜单同步完成前也保留原生编辑操作，避免复制、粘贴依赖界面初始化成功。
    setStartupApplicationMenu();
    installKernelRequestLog(session.defaultSession, {getTarget: getWindowKernelTarget});
    // 仅本进程启动的本地内核允许自签名证书，远程内核始终使用系统信任链。
    const kernelMode = state.startup.remoteKernelTarget ? "remote" : "local";
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
        if (shouldTrustLocalKernelCertificate(kernelMode, request.hostname)) {
            callback(0); // 验证通过
        } else {
            callback(-3); // 交由 Chromium 默认处理
        }
    });
};

export {bootstrap};
