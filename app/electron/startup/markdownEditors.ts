// 独立 Markdown 编辑器的接线：启动判定、文件路由与退出保护都汇总在这里。
// `electron/markdown/` 只提供窗口能力，不了解工作空间、内核与更新流程。
import * as electron from "electron";
import * as nodePath from "node:path";
import {createMarkdownWindows, registerMarkdownSchemes} from "../markdown/windows";
import {createMarkdownSystemFonts} from "../markdown/systemFonts";
import {createQuickLookFontSync, publishQuickLookFonts} from "../markdown/quickLookFonts";
import {createMarkdownLifecycle} from "../markdown/lifecycle";
import {parseMarkdownLaunch} from "../markdown/launch";
import {isSystemShuttingDown, paths, state, writeLog} from "../shared/runtime";
import {errorMessage} from "../shared/errors";
import {resolveAppLanguage} from "../shared/language";
import {getArgFrom} from "../shared/argv";
import {getTitleBarOverlayOptions, updateTitleBarOverlay} from "../window/windowControlsOverlay";
import {isDevToolsShortcut, toggleDevTools} from "../window/devToolsDock";
import {getBootWindows} from "../window/windowRegistry";
import type {ExpectedMarkdownFile} from "../markdown/disk";
import type {MarkdownLaunchRequest} from "../shared/types";

// 文件请求来自轻量入口：`--markdown[=file]`、位置参数里的 Markdown 路径，以及 macOS 的文件打开事件。
const isMarkdownLaunchRequested = (argv: string[]): boolean =>
    parseMarkdownLaunch(argv, process.cwd()).requested;

/**
 * 判定本次启动是否只打开独立 Markdown 窗口。
 *
 * 必须在 `whenReady` 之前调用：判定结果决定是否读取工作空间记录与崩溃信息。
 */
const detectMarkdownStartup = (argv: string[]): void => {
    state.markdown.startup = isMarkdownLaunchRequested(argv);
    // 初始命令行请求必须先入队，避免 ready 前的文件打开事件覆盖它。
    if (state.markdown.startup) {
        state.markdown.pendingLaunches.push({argv: [...argv], cwd: process.cwd()});
    }
};

// 自定义协议只能在 app ready 之前登记，因此与启动判定一起在入口早期完成。
const prepareMarkdownSchemes = (): void => registerMarkdownSchemes(electron.protocol);

// 待打开文件的操作由窗口管理器串行执行：两次启动请求不能交叉打开同一个文件。
const drainMarkdownLaunches = (): void => {
    const windows = state.markdown.windows;
    if (!windows || state.markdown.launchTask) {
        return;
    }
    state.markdown.launchTask = (async () => {
        while (state.markdown.pendingLaunches.length > 0) {
            const launch = state.markdown.pendingLaunches.shift() as MarkdownLaunchRequest;
            try {
                await windows.handleLaunch(launch.argv, launch.cwd);
            } catch (error) {
                writeLog("open Markdown file failed: " + errorMessage(error));
            }
        }
    })().finally(() => {
        state.markdown.launchTask = undefined;
        quitIfMarkdownStartupLeftNothing();
    });
};

// 所有入口都失败或被取消时，不留下一个没有窗口的独立进程。
const quitIfMarkdownStartupLeftNothing = (): void => {
    if (!state.markdown.startup) {
        return;
    }
    if (state.markdown.pendingLaunches.length > 0 || state.markdown.launchTask) {
        return;
    }
    if (electron.BrowserWindow.getAllWindows().length > 0 || state.workspaces.length > 0 ||
        state.kernel.startups.size > 0 || getBootWindows().size > 0) {
        return;
    }
    if (state.markdown.lifecycle?.busy() || state.exit.updateInstall || isSystemShuttingDown()) {
        return;
    }
    electron.app.quit();
};

/**
 * 路由一次启动参数；不是文件请求时返回 false，由工作空间的第二实例流程继续处理。
 *
 * `--markdown` 不带路径时按空白编辑器打开，与直接启动一致。
 */
const routeMarkdownLaunch = (argv: string[], cwd = process.cwd()): boolean => {
    if (!isMarkdownLaunchRequested(argv)) {
        return false;
    }
    state.markdown.pendingLaunches.push({argv: [...argv], cwd});
    drainMarkdownLaunches();
    return true;
};

// app ready 后创建窗口管理器与退出协调；Markdown 关闭最后一个窗口时由 onEmpty 决定是否退出。
const createMarkdownEditors = (): void => {
    const {app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeTheme} = electron;
    const systemFonts = createMarkdownSystemFonts(nodePath.join(paths.appDir, "kernel", process.platform === "win32" ? "SiYuan-Kernel.exe" : "SiYuan-Kernel"));
    app.once("will-quit", () => systemFonts.dispose());
    const quickLookFonts = process.platform === "darwin" && app.isPackaged ? createQuickLookFontSync(
        nodePath.join(paths.confDir, "markdown"),
        (publication, signal) => publishQuickLookFonts(nodePath.join(nodePath.dirname(app.getPath("exe")), "SiYuanQuickLookFonts"), publication, signal),
        error => writeLog("synchronize Quick Look fonts failed: " + errorMessage(error))) : undefined;
    if (quickLookFonts) {
        void quickLookFonts.refresh();
        app.once("will-quit", () => quickLookFonts.close());
    }
    state.markdown.windows = createMarkdownWindows({
        app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeTheme,
        rootDirectory: paths.appDir,
        configDirectory: nodePath.join(paths.confDir, "markdown"),
        lang: resolveAppLanguage(getArgFrom(process.argv, "--lang") ?
            [getArgFrom(process.argv, "--lang") as string] : app.getPreferredSystemLanguages()),
        systemFonts,
        onAppearance: () => { void quickLookFonts?.refresh(); },
        platform: process.platform,
        windowControls: {getOptions: getTitleBarOverlayOptions, update: updateTitleBarOverlay},
        devTools: {isShortcut: isDevToolsShortcut, toggle: toggleDevTools},
        onEmpty: quitIfMarkdownStartupLeftNothing,
    });

    state.markdown.lifecycle = createMarkdownLifecycle({
        getManager: () => state.markdown.windows,
        quit: () => app.quit(),
        log: writeLog,
    });
};

// 退出前请求所有 Markdown 窗口保存；取消时返回 false，调用方必须放弃本次退出。
const prepareMarkdownQuit = async (reason: string): Promise<boolean> =>
    await state.markdown.lifecycle?.prepare(reason) ?? true;

// 关闭全部 Markdown 窗口；取消时返回 false。
const closeMarkdownEditors = async (): Promise<boolean> =>
    await state.markdown.lifecycle?.finish() ?? true;

// 撤销进行中的 Markdown 退出请求，让窗口重新进入可编辑状态。
const cancelMarkdownQuit = (): void => state.markdown.lifecycle?.cancel();

// 从桌面主菜单新建一个独立 Markdown 编辑窗口。
const openMarkdownEditor = (source?: string): void => {
    const windows = state.markdown.windows;
    if (!windows) {
        return;
    }
    void windows.open(undefined, undefined, source).catch((error: unknown) => writeLog("open Markdown editor failed: " + errorMessage(error)));
};

// Called only after the IPC asset resolver has authorized a local workspace asset.
const openMarkdownAsset = async (file: ExpectedMarkdownFile, source?: string): Promise<void> => {
    if (!state.markdown.windows) throw new Error("Markdown editor is unavailable");
    await state.markdown.windows.open(file.path, file, source);
};

/** 正在执行一次 Markdown 退出协调。 */
const isMarkdownBusy = (): boolean => state.markdown.lifecycle?.busy() ?? false;

/** 进程退出前 Markdown 窗口还有未完成的工作。 */
const hasPendingMarkdownWork = (): boolean => state.markdown.lifecycle?.hasPendingWork() ?? false;

/** 窗口属于独立 Markdown 编辑器时，退出流程不能销毁它。 */
const ownsMarkdownWindow = (contents: {id: number}): boolean => state.markdown.windows?.owns(contents) ?? false;

/** 本次启动只打开独立 Markdown 窗口。 */
const isMarkdownStartup = (): boolean => state.markdown.startup;

/** macOS 在启动前后都可能收到文件打开事件，此处只登记判定，路由由调用方继续。 */
const acceptMarkdownFileOpen = (): void => {
    state.markdown.startup = true;
};

export {
    detectMarkdownStartup,
    prepareMarkdownSchemes,
    createMarkdownEditors,
    drainMarkdownLaunches,
    routeMarkdownLaunch,
    prepareMarkdownQuit,
    closeMarkdownEditors,
    cancelMarkdownQuit,
    openMarkdownEditor,
    openMarkdownAsset,
    isMarkdownBusy,
    hasPendingMarkdownWork,
    ownsMarkdownWindow,
    isMarkdownStartup,
    acceptMarkdownFileOpen,
};
