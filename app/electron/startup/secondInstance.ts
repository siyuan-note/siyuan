// 第二个实例的启动参数转发：远端内核只转发深链，本地内核复用已开工作空间或启动新工作空间。
// 运行期状态直接读 `runtime.state`，只有启动内核与创建主窗口由入口传入。
import {errorMessage} from "../shared/errors";
import {getArgFrom} from "../shared/argv";
import {findDeepLink} from "../shared/builtinArgs";
import {showWindow} from "../window/windowVisibility";
import {isWindowInitialized} from "../window/windowRegistry";
import {normalizeRemoteKernelOrigin, shouldForwardRemoteDeepLink} from "../remote/remoteKernel";
import {state, writeLog} from "../shared/runtime";
import {routeMarkdownLaunch} from "./markdownEditors";
import {resumeWorkspaceStartup} from "./startupBranches";
import type {Event as ElectronEvent} from "electron";
import type {InitKernel, InitMainWindow, Workspace} from "../shared/types";
import {Channel} from "../shared/channels";

/** 启动交接：拉起内核与创建主窗口。 */
type SecondInstanceHandlers = {
    initKernel: InitKernel;
    initMainWindow: InitMainWindow;
};

// 远端模式：只要深链，路径只用于判断是否有人在请求本地目标。
const openRemoteTarget = (argv: string[]): void => {
    const remoteKernelTarget = state.startup.remoteKernelTarget;
    const secondRemoteArg = getArgFrom(argv, "--remote");
    const siyuanURL = findDeepLink(argv);
    const localTargetRequested = getArgFrom(argv, "--workspace") !== undefined ||
        getArgFrom(argv, "--port") !== undefined;
    let secondRemoteOrigin: string | undefined;
    if (secondRemoteArg !== undefined) {
        try {
            secondRemoteOrigin = normalizeRemoteKernelOrigin(secondRemoteArg);
            writeLog("got second-instance remote kernel [origin=" + secondRemoteOrigin + "]");
            if (!remoteKernelTarget || secondRemoteOrigin !== remoteKernelTarget.origin) {
                writeLog("ignored a different remote kernel while another SiYuan instance is running");
            }
        } catch (error) {
            writeLog("ignored invalid second-instance remote kernel: " + errorMessage(error));
        }
    }

    if (remoteKernelTarget && localTargetRequested) {
        writeLog("ignored opening a local kernel target while remote kernel mode is running");
    }

    const allowDeepLink = shouldForwardRemoteDeepLink({
        currentOrigin: remoteKernelTarget?.origin,
        requestedOrigin: secondRemoteOrigin,
        remoteArgumentPresent: secondRemoteArg !== undefined,
        localTargetRequested,
    });

    if (state.workspaces.length > 0) {
        const mainWindow = state.workspaces[0].browserWindow;
        showWindow(mainWindow);
        if (siyuanURL && allowDeepLink && isWindowInitialized(mainWindow.webContents.id)) {
            mainWindow.webContents.send(Channel.SIYUAN_OPEN_URL, siyuanURL);
        } else if (siyuanURL && allowDeepLink) {
            state.pendingRemoteOpenURLs.push(siyuanURL);
        }
    } else if (siyuanURL && allowDeepLink) {
        state.pendingRemoteOpenURLs.push(siyuanURL);
    }
};

// 本地模式：先复用同名工作空间，否则按参数启动；都没有时把深链转给现有窗口。
const openLocalTarget = (argv: string[], {initKernel, initMainWindow}: SecondInstanceHandlers): void => {
    const workspace = getArgFrom(argv, "--workspace");
    if (workspace) {
        writeLog("got second-instance arg [--workspace=" + workspace + "]");
    }
    let port: string | number | undefined = getArgFrom(argv, "--port");
    if (port) {
        writeLog("got second-instance arg [--port=" + port + "]");
    } else {
        port = 0;
    }
    let lang: string | undefined = getArgFrom(argv, "--lang");
    if (lang) {
        writeLog("got second-instance arg [--lang=" + lang + "]");
    } else {
        lang = "";
    }

    const foundWorkspace = state.workspaces.find((item: Workspace) => {
        if (item.browserWindow && !item.browserWindow.isDestroyed()) {
            if (workspace && workspace === item.workspaceDir) {
                showWindow(item.browserWindow);
                return true;
            }
        }
    });
    if (foundWorkspace) {
        return;
    }
    if (workspace) {
        initKernel({workspace, port, lang}).then((startedKernelPort) => {
            if (startedKernelPort) {
                initMainWindow(startedKernelPort);
            }
        });
        return;
    }

    const siyuanURL = findDeepLink(argv);
    state.workspaces.forEach((item: Workspace) => {
        if (item.browserWindow && !item.browserWindow.isDestroyed() && siyuanURL) {
            item.browserWindow.webContents.send(Channel.SIYUAN_OPEN_URL, siyuanURL);
        }
    });

    if (!siyuanURL && 0 < state.workspaces.length) {
        showWindow(state.workspaces[0].browserWindow);
    } else if (!siyuanURL && 0 < state.kernel.startups.size) {
        showWindow(Array.from(state.kernel.startups.values())[0].window);
    }
};

// 安装更新中、远端参数无效时直接忽略，避免打断正在进行的安装流程。
const handleSecondInstance = (argv: string[], handlers: SecondInstanceHandlers, workingDirectory?: string): void => {
    writeLog("second-instance [" + argv + "]");
    if (state.exit.updateInstall) {
        writeLog("ignored second instance while installing update");
        return;
    }
    // 文件请求先于工作空间参数处理：同一进程可以同时管理多个轻量编辑窗口。
    // 整个 argv 交给解析器，可执行文件与应用路径不带 .md 后缀，不会被当成待打开文件。
    if (routeMarkdownLaunch(argv, workingDirectory ?? process.cwd())) {
        return;
    }

    if (state.markdown.startup && state.workspaces.length === 0 && state.kernel.startups.size === 0 &&
        getArgFrom(argv, "--remote") === undefined) {
        resumeWorkspaceStartup(argv, handlers);
        return;
    }

    if (state.startup.remoteKernelArgError) {
        writeLog("ignored second instance because the primary remote kernel argument is invalid");
        return;
    }
    if (getArgFrom(argv, "--remote") !== undefined || state.startup.remoteKernelTarget) {
        openRemoteTarget(argv);
        return;
    }
    openLocalTarget(argv, handlers);
};

// 第二实例可能在取锁之后、app 就绪之前到达，那时还建不了窗口，因此统一先入队。
let handlers: SecondInstanceHandlers | undefined;
let pendingArgv: {argv: string[]; cwd: string}[] = [];

const queueSecondInstance = (_event: ElectronEvent, argv: string[], workingDirectory?: string): void => {
    if (!handlers) {
        pendingArgv.push({argv, cwd: workingDirectory || process.cwd()});
        return;
    }
    handleSecondInstance(argv, handlers, workingDirectory);
};

// 按到达顺序重放积压的第二实例，后续事件直接处理。
const startSecondInstance = (next: SecondInstanceHandlers): void => {
    handlers = next;
    const pending = pendingArgv;
    pendingArgv = [];
    pending.forEach(({argv, cwd}) => handleSecondInstance(argv, next, cwd));
};

export {queueSecondInstance, startSecondInstance};
