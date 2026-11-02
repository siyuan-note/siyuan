// 主进程共享的领域类型。类型只在编译期存在，运行时仍是 CommonJS。
import type {BrowserWindow, Tray} from "electron";

/** 日志输出函数。单条写入失败不得抛出。 */
export type LogFunction = (message: string) => void;

/** 内核连接目标。本地内核由本进程拉起，远端内核由用户配置。 */
export type KernelTarget = {
    mode: "local" | "remote";
    origin: string;
    ownsKernel: boolean;
    port: string;
    // 远端内核下用户是否信任该服务器下发的扩展；仅 remote 模式使用。
    trustRemoteExtensions?: boolean;
    // 信任远端扩展时为主进程生成的脚本授权随机数。
    extensionScriptNonce?: string;
};

/** 一个已完成初始化的窗口工作空间。 */
export type Workspace = {
    browserWindow: BrowserWindow;
    webContentsId: number;
    port: string | number;
    ownsKernel: boolean;
    kernelTarget: KernelTarget;
    workspaceDir?: string;
    tray?: Tray;
    /** 前端首次初始化完成后置位，之前不接收业务消息。 */
    initialized?: boolean;
    /** 托盘菜单文案，随前端同步的语言变化。 */
    hotkeyLanguages?: Record<string, string>;
    /** 当前工作空间生效的全局快捷键。 */
    hotkeys?: string[];
    /** 触发窗口显隐的快捷键。 */
    toggleHotkeys?: string[];
    /** 快捷键被暂停（前端正在重绑）时不再注册。 */
    shortcutsSuspended?: boolean;
};

/** 与内核 /api/system/exit 契约一致。 */
export type KernelExitOptions = {
    force?: boolean;
    setCurrentWorkspace?: boolean;
    execInstallPkg?: number;
};

/** 预创建的启动页与端口；主窗口接管该窗口完成首帧收尾。 */
export type PreparedBoot = {window: BootWindow; ready: Promise<string | number>};

/** 拉起本地内核的参数；省略的字段按启动流程的约定回退。 */
export type KernelStartRequest = {
    /** 目标工作空间。省略时依次回退到 SIYUAN_WORKSPACE_PATH 与上次打开的工作空间。 */
    workspace?: string;
    /** 内核端口。省略或为空时自动分配。 */
    port?: string | number;
    /** 界面语言。 */
    lang?: string;
    /** 安全模式启动，不加载插件与自定义外观。 */
    safeMode?: boolean;
    /** whenReady 阶段提前创建的启动页窗口。 */
    preparedBoot?: PreparedBoot;
};

/** 拉起本地内核并返回端口；失败或被取消时返回 undefined。 */
export type InitKernel = (request: KernelStartRequest) => Promise<string | number | undefined>;

/** 按内核端口创建并登记主窗口。 */
export type InitMainWindow = (kernel?: string | number | KernelTarget, remoteAuthenticated?: boolean) => void;

/** 启动流程中登记的一次内核启动。 */
export type KernelStartup = {
    workspace?: string;
    window: BootWindow;
    ownsKernel: boolean;
    devPort?: string | number;
    port?: string | number;
    process?: unknown;
    kernelRunning?: boolean;
    exitRequested?: boolean;
    canceled?: boolean;
    previousExitWaiting?: string;
};

// 请求内核退出：传输层由调用方提供，返回 undefined 表示请求本身失败。
export type KernelExitResponse = {json: () => Promise<{code: number}>};
export type KernelExitRequest = (port: string | number, options: KernelExitOptions,
    signal?: AbortSignal) => Promise<KernelExitResponse | undefined>;

// 入口在启动早期调用 configureRuntime 填入实际值。
export type RuntimePaths = {
    appDir: string;
    appVer: string;
    confDir: string;
    windowStatePath: string;
    linuxInputMethodSettingPath: string;
    accessibilitySettingPath: string;
    appCrashLogPath: string;
    appCrashMarkerPath: string;
    /** 启动页等 HTML/CSS 脚本所在目录。 */
    assetsDir: string;
    isDevEnv: boolean;
    simulateRosetta: boolean;
};

/** 一个已创建但可能尚未初始化的启动页窗口。 */
export type BootWindow = BrowserWindow & {
    appearanceFallback?: boolean;
    kernelPort?: string | number;
    lang?: string;
    previousExitWaiting?: string;
};

/** 重新加载启动页；省略的字段沿用当前启动页、内核端口与命令行语言。 */
export type LoadBootWindow = (options?: {
    /** 改为不带自定义外观加载，用于启动页失去响应或渲染进程崩溃。 */
    disableAppearance?: boolean;
    window?: BootWindow;
    port?: string | number;
    lang?: string;
}) => void;

/**
 * 启动页能力，由 `window/bootWindows.ts` 提供。
 *
 * kernel 与 remote 不能直接引用 window 层，因此入口把这份能力注入它们，两处使用同一套成员名。
 */
export type BootWindowsApi = {
    createBootWindow: () => BootWindow;
    loadBootWindow: LoadBootWindow;
    /** 当前启动页窗口，尚未创建时为 undefined。 */
    getBootWindow: () => BootWindow | undefined;
    getAvailablePort: (port?: string | number, useDevKernel?: boolean) => Promise<string | number>;
    showLocalBootWindow: (window: BootWindow, port: string | number, lang?: string) => void;
};

/**
 * 启动期快照：入口在 `whenReady` 之前一次性写入，之后全体只读。
 *
 * 这些值来自命令行、环境变量与上次工作空间记录，运行期不再变化，因此整组冻结。
 */
export type StartupSnapshot = {
    /** 远端内核目标，本地内核模式为 undefined。 */
    remoteKernelTarget?: KernelTarget;
    /** 远端内核参数错误，入口解析失败时写入。 */
    remoteKernelArgError?: {code?: string; message?: string};
    /** 尚无工作空间记录，弹出首次选择窗口。 */
    firstOpen: boolean;
    openAsHidden: boolean;
    /** 命令行附带的 siyuan:// 深链，没有时为空串。 */
    initialDeepLink: string;
    lastWorkspacePath: string;
    lastWorkspaceMissing: boolean;
    missingWorkspacePath: string;
    availableWorkspaces: string[];
};

/**
 * 本地内核账本：端口、启动中/已运行的内核进程与退出证据。
 *
 * 容器在进程生命周期内保持同一引用，模块可以长期持有。
 */
export type KernelBookkeeping = {
    /** 本地内核端口，未分配时为空字符串。 */
    port: string | number;
    /** 正在启动的工作空间，键为启动键。 */
    startups: Map<string, KernelStartup>;
    /** 已拉起的本地内核进程，键为端口字符串。 */
    processes: Map<string, import("node:child_process").ChildProcess>;
    /** 预期退出的端口，不作为异常上报。 */
    expectedExitPorts: Set<string>;
    exitedPorts: Set<string>;
};

/** 窗口账本，按 webContents id 索引，只经 windowRegistry 读写。 */
export type WindowLedger = {
    targets: Map<number, KernelTarget>;
    /** 已领取内核能力（`siyuan-init`）的窗口。 */
    initialized: Set<number>;
    /** 已发出首次 `siyuan-event` 握手、可接收业务消息的窗口。 */
    handshaken: Set<number>;
    expectedRendererExit: Set<number>;
    activeWindow?: BrowserWindow;
    bootWindows: Set<BootWindow>;
    currentBoot?: BootWindow;
};

/** 关机阶段：未开始、优雅退出进行中、强制退出。 */
export type SystemShutdownPhase = 0 | 1 | 2;

/** 一次待打开的独立 Markdown 请求。 */
export type MarkdownLaunchRequest = {argv: string[]; cwd: string};

/**
 * 独立 Markdown 编辑器的运行期状态。
 *
 * `startup` 在 app ready 之前就要可写：macOS 的 `open-file` 可能早于启动判定，
 * 因此它不能放进只读的启动快照。
 */
export type MarkdownState = {
    /** 本次启动只打开独立 Markdown 窗口，不初始化工作空间。 */
    startup: boolean;
    /** 窗口管理器，app ready 后创建。 */
    windows?: import("../markdown/windows").MarkdownWindows;
    /** 退出协调，与窗口管理器一起创建。 */
    lifecycle?: import("../markdown/lifecycle").MarkdownLifecycle;
    /** 正在排空待打开文件的任务，避免并发重复处理。 */
    launchTask?: Promise<void>;
    /** 尚未处理完的文件请求。 */
    pendingLaunches: MarkdownLaunchRequest[];
};

/** 退出编排状态。这些字段共同决定应用这次是否真的退出。 */
export type ExitState = {
    systemShutdown: SystemShutdownPhase;
    /** 进行中的优雅退出，防止重复触发。 */
    gracefulShutdown?: Promise<void>;
    /** 关机期间保持应用存活，等内核退出。 */
    keepOpenForShutdown: boolean;
    /** 进行中的更新安装流程。 */
    updateInstall?: Promise<void>;
    /** 更新安装期间保持应用存活，等安装器接管。 */
    keepOpenForUpdate: boolean;
    pendingConnectionArgs?: string[];
    resetWindowStateOnRestart: boolean;
};

/**
 * 由 `runtime.state` 唯一持有，按写入时机分组：启动快照只读，内核与窗口账本按 id 索引，
 * 退出状态决定生命周期；`workspaces` 是所有窗口共用的集合，因此保留在顶层。
 */
export type RuntimeState = {
    startup: StartupSnapshot;
    kernel: KernelBookkeeping;
    windows: WindowLedger;
    exit: ExitState;
    /** 独立 Markdown 编辑器的状态；与工作空间互不影响。 */
    markdown: MarkdownState;
    workspaces: Workspace[];
    /** 远端内核窗口就绪前积累的 siyuan:// 链接。 */
    pendingRemoteOpenURLs: string[];
};
