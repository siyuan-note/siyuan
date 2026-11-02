import * as path from "node:path";
import * as fs from "node:fs";
import * as electron from "electron";
import {paths, state, writeLog} from "../shared/runtime";
import {getArgFrom} from "../shared/argv";
import {showErrorWindow} from "../shared/errorWindow";
import {
    invalidRemoteKernelAddressMessage, remoteKernelConnectFailedMessage, unsafeRemoteKernelArgumentsMessage,
} from "../shared/staticMessages";
import {resolveAppLanguage} from "../shared/language";
import {clearAppCrashInfo} from "../shared/crashHistory";
import {appIconPath, LOCAL_PAGE_WEB_PREFERENCES} from "../shared/desktopDefaults";
import {getCurrentBootWindow} from "../window/windowRegistry";
import * as bootWindows from "../window/bootWindows";
import {initRemoteKernel} from "../remote/remoteBoot";
import type {StaticMessage} from "../shared/staticMessages";
import type {BrowserWindow} from "electron";
import type {InitKernel, InitMainWindow, KernelTarget, PreparedBoot} from "../shared/types";
import {Channel} from "../shared/channels";

// 静态文案自带中英双语，组装成错误窗口的三段参数。
const showStaticMessage = (message: StaticMessage): void => {
    showErrorWindow(message.titleZh, message.titleEn, message.content);
};

// 六条启动分支。分支字段与各自的载荷绑在一起，构造不出「分支与载荷不匹配」的组合。
type StartupBranch =
    | {branch: "remote-arg-invalid"; remoteKernelArgError: {code?: string} | undefined}
    | {branch: "remote-target"; remoteKernelTarget: KernelTarget}
    | {branch: "first-open"}
    | {branch: "crash-recovery"; appCrashInfo: {workspaceDir?: string; crashInfo: string}}
    | {branch: "workspace-missing"}
    | {branch: "local-kernel"};

type StartupContext = StartupBranch & {
    // 安全模式与工作空间丢失窗口选择后启动内核用；本地内核分支也共用。
    initKernel: InitKernel;
    initMainWindow: InitMainWindow;
    /** 本次启动实际生效的命令行，由入口在兼容模式处理之后传入。 */
    launchArguments: string[];
    preparedBoot: PreparedBoot | undefined;
    startupStartedAt: number;
};

// 按启动条件选定分支，载荷随分支一起给出。
const resolveStartupBranch = (
    appCrashInfo: {workspaceDir?: string; crashInfo: string} | undefined): StartupBranch => {
    if (state.startup.remoteKernelArgError) {
        return {branch: "remote-arg-invalid", remoteKernelArgError: state.startup.remoteKernelArgError};
    }
    if (state.startup.remoteKernelTarget) {
        return {branch: "remote-target", remoteKernelTarget: state.startup.remoteKernelTarget};
    }
    if (state.startup.firstOpen) {
        return {branch: "first-open"};
    }
    if (appCrashInfo) {
        return {branch: "crash-recovery", appCrashInfo};
    }
    if (state.startup.lastWorkspaceMissing) {
        return {branch: "workspace-missing"};
    }
    return {branch: "local-kernel"};
};

const isDirectory = (filePath: string): boolean => {
    try {
        return !!filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
    } catch {
        return false;
    }
};

// 工作空间选择页（崩溃恢复与目录丢失）共用同一窗口比例。
const WORKSPACE_CHOICE_RATIO = {widthRatio: 0.55, heightRatio: 0.65};

// 创建并加载一个启动页窗口；渲染进程回传选择后的绑定由 bindWorkspaceChoice 处理。
const showStartupWindow = ({html, query = {}, widthRatio, heightRatio}: {
    html: string;
    query?: Record<string, string>;
    // 窗口尺寸按主屏宽与工作区高取比例。
    widthRatio: number;
    heightRatio: number;
}): BrowserWindow => {
    const window = new electron.BrowserWindow({
        width: Math.floor(electron.screen.getPrimaryDisplay().size.width * widthRatio),
        height: Math.floor(electron.screen.getPrimaryDisplay().workAreaSize.height * heightRatio),
        frame: "darwin" === process.platform,
        titleBarStyle: "hidden",
        fullscreenable: false,
        icon: appIconPath(),
        transparent: "darwin" === process.platform,
        webPreferences: {...LOCAL_PAGE_WEB_PREFERENCES},
    });
    window.loadFile(path.join(paths.assetsDir, html), {
        query: {
            lang: resolveAppLanguage(electron.app.getPreferredSystemLanguages()),
            home: electron.app.getPath("home"),
            v: paths.appVer,
            icon: appIconPath(),
            ...query,
        },
    });
    window.show();
    return window;
};

// 启动页回传选择后要执行的绑定。
type WorkspaceChoiceBinding = {
    context: StartupContext;
    channel: string;
    window: BrowserWindow;
    onStarted?: () => void;
};

// 启动窗口回传用户选择后启动内核：成功才进入主窗口，无论成败都关闭该启动窗口。
const bindWorkspaceChoice = ({context, channel, window, onStarted}: WorkspaceChoiceBinding): void => {
    electron.ipcMain.on(channel, (event, data: {workspace: string; lang: string; safeMode?: boolean}) => {
        void context.initKernel({workspace: data.workspace, lang: data.lang, safeMode: data.safeMode})
            .then((startedKernelPort) => {
                if (startedKernelPort) {
                    onStarted?.();
                    context.initMainWindow(startedKernelPort);
                }
            });
        window.destroy();
    });
};

// 分支在编译期穷尽，新增分支时由 assertNever 报错。
const assertNever = (value: never): never => {
    throw new Error("unhandled startup branch: " + JSON.stringify(value));
};

// 每个分支只决定「开哪个窗口、拉哪个内核」；载荷由分支类型保证存在，因此这里不需要再判空。
const runStartupBranch = (context: StartupContext): void => {
    switch (context.branch) {
        case "remote-arg-invalid":
            showRemoteArgumentError(context.remoteKernelArgError);
            return;

        case "remote-target":
            startRemoteTarget(context, context.remoteKernelTarget);
            return;

        case "first-open":
            openFirstWorkspaceWindow(context);
            return;

        case "crash-recovery":
            openCrashRecoveryWindow(context, context.appCrashInfo);
            return;

        case "workspace-missing":
            openMissingWorkspaceWindow(context);
            return;

        case "local-kernel":
            startLocalKernel(context);
            return;

        default:
            assertNever(context);
    }
};

// 远端参数无效或带不安全开关：直接给出静态错误窗口，不进入任何启动页。
const showRemoteArgumentError = (error: {code?: string} | undefined): void => {
    showStaticMessage(error?.code === "ERR_REMOTE_UNSAFE_CHROMIUM_SWITCH" ?
        unsafeRemoteKernelArgumentsMessage : invalidRemoteKernelAddressMessage);
};

// 远端内核：先连接并认证，成功后进主窗口；失败关闭启动页并提示。
const startRemoteTarget = (context: StartupContext, target: KernelTarget): void => {
    void initRemoteKernel(target, bootWindows).then((result) => {
        if (result) {
            context.initMainWindow(result.target, result.authenticated);
        }
    }).catch((error: unknown) => {
        writeLog("initialize remote kernel failed: " + error);
        const bootWindow = getCurrentBootWindow();
        if (bootWindow && !bootWindow.isDestroyed()) {
            bootWindow.destroy();
        }
        showStaticMessage(remoteKernelConnectFailedMessage);
    });
};

// 首次启动：用户选择语言与工作空间目录后拉起内核。
const openFirstWorkspaceWindow = (context: StartupContext): void => {
    const firstOpenWindow = showStartupWindow({html: "init.html", widthRatio: 0.6, heightRatio: 0.8});
    bindWorkspaceChoice({context, channel: Channel.SIYUAN_FIRST_INIT, window: firstOpenWindow});
};

// 崩溃恢复：定位崩溃的工作空间，带上安全模式选项；仅内核成功启动后才清除崩溃信息。
const openCrashRecoveryWindow = (context: StartupContext,
    appCrashInfo: {workspaceDir?: string; crashInfo: string}): void => {
    // 崩溃信息里的目录优先；没有记录或目录已不存在时退回最近可用的工作空间。
    let crashWorkspace = appCrashInfo.workspaceDir || state.startup.lastWorkspacePath;
    if (!appCrashInfo.workspaceDir && !isDirectory(crashWorkspace)) {
        const availableWorkspaces = state.startup.availableWorkspaces;
        crashWorkspace = availableWorkspaces[availableWorkspaces.length - 1] || state.startup.lastWorkspacePath;
    }
    const crashWorkspaceMissing = !isDirectory(crashWorkspace);
    const safeModeWindow = showStartupWindow({
        html: "workspace.html",
        query: {
            crash: "1",
            workspace: crashWorkspace,
            crashWorkspaceMissing: crashWorkspaceMissing ? "1" : "0",
            missing: crashWorkspaceMissing ? crashWorkspace : "",
            crashInfo: appCrashInfo.crashInfo,
        },
        ...WORKSPACE_CHOICE_RATIO,
    });
    bindWorkspaceChoice({
        context, channel: Channel.SIYUAN_SELECT_WORKSPACE, window: safeModeWindow, onStarted: clearAppCrashInfo,
    });
};

// 上次的工作空间已不存在：列出可用工作空间让用户重选。
const openMissingWorkspaceWindow = (context: StartupContext): void => {
    const missingWorkspaceWindow = showStartupWindow({
        html: "workspace.html",
        query: {
            missing: state.startup.missingWorkspacePath,
            workspaces: state.startup.availableWorkspaces.join("\n"),
        },
        ...WORKSPACE_CHOICE_RATIO,
    });
    bindWorkspaceChoice({context, channel: Channel.SIYUAN_SELECT_WORKSPACE, window: missingWorkspaceWindow});
};

// 本地内核：命令行的工作空间、端口、语言与安全模式直接交给启动编排，启动页可能已提前创建。
const startLocalKernel = (context: StartupContext): void => {
    const workspace = getArgFrom(context.launchArguments, "--workspace");
    if (workspace) {
        writeLog("got arg [--workspace=" + workspace + "]");
    }
    const port = getArgFrom(context.launchArguments, "--port");
    if (port) {
        writeLog("got arg [--port=" + port + "]");
    }
    const safeMode = getArgFrom(context.launchArguments, "--safe-mode") === "true";
    if (safeMode) {
        writeLog("got arg [--safe-mode=true]");
    }
    const lang = getArgFrom(context.launchArguments, "--lang") || "";
    if (lang) {
        writeLog("got arg [--lang=" + lang + "]");
    }

    writeLog("initializing local kernel [" + (Date.now() - context.startupStartedAt) + "ms since app ready]");
    void context.initKernel({workspace, port, lang, safeMode, preparedBoot: context.preparedBoot})
        .then((startedKernelPort) => {
            if (startedKernelPort) {
                context.initMainWindow(startedKernelPort);
            }
        });
};

export {runStartupBranch, resolveStartupBranch};
