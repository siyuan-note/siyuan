import {getArgFrom} from "./argv";
import type {RuntimePaths, RuntimeState, SystemShutdownPhase} from "./types";

// 运行期状态的唯一归属：模块直接读取 runtime.state，不通过函数参数注入同一份状态。
// 容器在进程生命周期内保持同一引用（只有 startup 快照会整组替换），因此可以安全地长期持有。
// 测试改用 resetRuntimeState 准备起点，而不是替换注入对象。
const paths: RuntimePaths = {
    appDir: "",
    appVer: "",
    confDir: "",
    windowStatePath: "",
    linuxInputMethodSettingPath: "",
    accessibilitySettingPath: "",
    appCrashLogPath: "",
    appCrashMarkerPath: "",
    assetsDir: "",
    isDevEnv: false,
    simulateRosetta: false,
};

const SYSTEM_SHUTDOWN_NONE: SystemShutdownPhase = 0;
const SYSTEM_SHUTDOWN_ENDING: SystemShutdownPhase = 1;
const SYSTEM_SHUTDOWN_FORCED: SystemShutdownPhase = 2;

// 启动快照由入口在启动早期整组替换，其余三组在进程生命周期内保持同一引用。
const state: RuntimeState = {
    startup: {
        firstOpen: false,
        openAsHidden: false,
        initialDeepLink: "",
        lastWorkspacePath: "",
        lastWorkspaceMissing: false,
        missingWorkspacePath: "",
        availableWorkspaces: [],
    },
    kernel: {
        port: "",
        startups: new Map(),
        processes: new Map(),
        expectedExitPorts: new Set(),
        exitedPorts: new Set(),
    },
    windows: {
        targets: new Map(),
        initialized: new Set(),
        handshaken: new Set(),
        expectedRendererExit: new Set(),
        bootWindows: new Set(),
    },
    exit: {
        systemShutdown: SYSTEM_SHUTDOWN_NONE,
        keepOpenForShutdown: false,
        keepOpenForUpdate: false,
        resetWindowStateOnRestart: false,
    },
    markdown: {
        startup: false,
        windows: undefined,
        lifecycle: undefined,
        launchTask: undefined,
        pendingLaunches: [],
    },
    workspaces: [],
    pendingRemoteOpenURLs: [],
};

// 启动快照只写一次：整组替换并冻结，任何模块都不能修改已经确定的启动条件。
const setStartupSnapshot = (snapshot: RuntimeState["startup"]): void => {
    state.startup = Object.freeze({...snapshot});
};

let writeLogImpl: (message: string) => void = () => {};
let consoleImpl: Pick<Console, "error"> = console;

// 全部路径都是必填项：漏传会让读写落到空字符串，错误又被写日志吞掉。
const configureRuntime = (options: RuntimePaths & {
    writeLog?: (message: string) => void;
    console?: Pick<Console, "error">;
}) => {
    for (const key of Object.keys(paths) as (keyof RuntimePaths)[]) {
        (paths as unknown as Record<string, unknown>)[key] = options[key];
    }
    if (options.writeLog) {
        writeLogImpl = options.writeLog;
    }
    if (options.console) {
        consoleImpl = options.console;
    }
};

const writeLog = (message: string) => writeLogImpl(message);

// 阶段推进只由 systemShutdown 状态机负责，其余模块只需要知道是否已在关机流程中。
const isSystemShuttingDown = (): boolean => state.exit.systemShutdown !== SYSTEM_SHUTDOWN_NONE;

const getConsole = (): Pick<Console, "error"> => consoleImpl;

const getArg = (name: string) => getArgFrom(process.argv, name);

// 测试专用：把运行期状态恢复为起点。容器在进程内保持同一引用，因此逐项清空而不是整体替换。
const resetRuntimeState = (): void => {
    state.startup = {
        firstOpen: false,
        openAsHidden: false,
        initialDeepLink: "",
        lastWorkspacePath: "",
        lastWorkspaceMissing: false,
        missingWorkspacePath: "",
        availableWorkspaces: [],
    };

    state.kernel.port = "";
    state.kernel.startups.clear();
    state.kernel.processes.clear();
    state.kernel.expectedExitPorts.clear();
    state.kernel.exitedPorts.clear();

    state.windows.targets.clear();
    state.windows.initialized.clear();
    state.windows.handshaken.clear();
    state.windows.expectedRendererExit.clear();
    state.windows.activeWindow = undefined;
    state.windows.bootWindows.clear();
    state.windows.currentBoot = undefined;

    state.exit.systemShutdown = SYSTEM_SHUTDOWN_NONE;
    state.exit.gracefulShutdown = undefined;
    state.exit.keepOpenForShutdown = false;
    state.exit.updateInstall = undefined;
    state.exit.keepOpenForUpdate = false;
    state.exit.resetWindowStateOnRestart = false;
    state.exit.pendingConnectionArgs = undefined;

    state.markdown.startup = false;
    state.markdown.windows = undefined;
    state.markdown.lifecycle = undefined;
    state.markdown.launchTask = undefined;
    state.markdown.pendingLaunches.length = 0;

    state.workspaces.length = 0;
    state.pendingRemoteOpenURLs.length = 0;
};

export {
    paths,
    state,
    setStartupSnapshot,
    configureRuntime,
    resetRuntimeState,
    writeLog,
    isSystemShuttingDown,
    getConsole,
    getArg,
    SYSTEM_SHUTDOWN_NONE,
    SYSTEM_SHUTDOWN_ENDING,
    SYSTEM_SHUTDOWN_FORCED,
};
