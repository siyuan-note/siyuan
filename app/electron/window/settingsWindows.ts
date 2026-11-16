import {normalizeWindowGeometry, captureWindowGeometry} from "./windowGeometry";
import {getCaptionHeight, getTitleBarOverlayOptions} from "./windowControlsOverlay";
import {APP_INDEX_PAGE, APP_PAGE, SETTINGS_PAGE, WINDOW_PAGE} from "../shared/pagePaths";
import {MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, appIconPath, desktopUserAgent} from "../shared/desktopDefaults";
import * as electron from "electron";
import {paths, writeLog} from "../shared/runtime";
import {requireElectronRemote} from "../shared/electronRemote";
import {getInitializedWindows, getWindowKernelTarget} from "./windowRegistry";
import {rememberWindowKernelTarget} from "./windowLifecycle";
import {bindSpellcheckContextMenu} from "./contextMenu";
import {installNavigationPolicy} from "./windowNavigation";
import {showWindow} from "./windowVisibility";
import {isDevToolsShortcut, toggleDevTools} from "./devToolsDock";
import type {
    BrowserWindow,
    BrowserWindowConstructorOptions,
    Event as ElectronEvent,
    HandlerDetails,
    Input,
    IpcMainEvent,
    IpcMainInvokeEvent,
    WebContents,
    WebContentsDidStartNavigationEventParams,
    WindowOpenHandlerResponse,
} from "electron";
import type {KernelTarget, LogFunction} from "../shared/types";
import {Channel} from "../shared/channels";

type SettingsWindowData = {
    key: string;
    token: string;
    command?: string;
    title?: string;
    compactMode?: boolean;
    geometry?: SettingsWindowGeometry;
};

type SettingsWindowGeometry = {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    maximized?: boolean;
    fullscreen?: boolean;
};

// 渲染就绪与首次绘制都完成后才显示，两者的先后顺序任意；只显示一次。
const shouldReveal = (approved: ApprovedWindow, win: BrowserWindow): boolean =>
    approved.active && approved.ready && approved.painted && !approved.shown && !win.isDestroyed();

// 设置键与令牌都来自渲染进程，两个入口（prepare / close）用同一套校验规则。
const SETTINGS_KEY_PATTERN = /^(builtin|plugin-[a-zA-Z0-9-]+)$/;
const SETTINGS_TOKEN_PATTERN = /^[a-zA-Z0-9-]{1,100}$/;
// 授权后等待窗口上报就绪与首次绘制的时长。
const SETTINGS_APPROVAL_TTL_MS = 60000;

// 一个设置窗口从授权到创建的记录，命中 key 即视为该键已被占用。
type ApprovedWindow = {
    key: string;
    target: KernelTarget;
    owner: WebContents;
    url: string;
    frameName: string;
    data: SettingsWindowData;
    requestedAt: number;
    revision?: number;
    active: boolean;
    expires: number;
    timer?: NodeJS.Timeout;
    created?: (win: BrowserWindow) => void;
    win?: BrowserWindow;
    ready: boolean;
    painted: boolean;
    shown: boolean;
    /** 由 ready 与 painted 触发的显示动作。 */
    reveal?: () => void;
};

type OwnerState = {records: Set<ApprovedWindow>};

const settingsPath = SETTINGS_PAGE;

// 设置窗口沿用主窗口的桌面 UA 与页面寻址，只有页面路径不同。
const initializeSettingsWindow = (window: BrowserWindow, target: KernelTarget): void => {
    requireElectronRemote().enable(window.webContents);
    bindSpellcheckContextMenu(window.webContents);
    rememberWindowKernelTarget(window, target);
    window.webContents.userAgent = desktopUserAgent(paths.appVer, window.webContents.userAgent);
    installNavigationPolicy(window, "settings", target);
};

// 只允许已登记的内核页面打开预先授权的设置页，不改变普通链接的打开规则。
const createSettingsWindows = ({initialize = initializeSettingsWindow,
    getTarget = getWindowKernelTarget, getWindows = getInitializedWindows,
    show = showWindow, log = writeLog, icon = appIconPath(),
    platform = process.platform}: {
        initialize?: (win: BrowserWindow, target: KernelTarget) => void;
        getTarget?: (webContentsId: number) => KernelTarget | undefined;
        getWindows?: (origin: string) => BrowserWindow[];
        show?: (win: BrowserWindow) => void;
        log?: LogFunction;
        icon?: string;
        platform?: NodeJS.Platform;
    } = {}) => {
    // 待创建（按 owner 与 frameName）与实际占用（按工作空间与设置键）各一张表。
    const pending = new Map<string, ApprovedWindow>();
    const registry = new Map<string, ApprovedWindow>();
    const owners = new WeakMap<WebContents, OwnerState>();
    let interfaceRevision = 0;
    const getSettingTarget = (event: {sender: WebContents; senderFrame?: unknown}): KernelTarget | undefined => {
        const target = getTarget(event.sender.id);
        if (!target || event.senderFrame !== event.sender.mainFrame) return;
        try {
            const url = new URL(event.sender.getURL());
            if (url.origin === target.origin &&
                [APP_PAGE, APP_INDEX_PAGE, WINDOW_PAGE].includes(url.pathname)) {
                return target;
            }
        } catch {
            return;
        }
    };
    const notifySettingDialogs = (target: KernelTarget, revision = ++interfaceRevision): number => {
        for (const win of getWindows(target.origin)) {
            if (win.isDestroyed()) continue;
            const contents = win.webContents;
            if (getSettingTarget({sender: contents, senderFrame: contents.mainFrame})?.origin !== target.origin) continue;
            try {
                contents.send(Channel.SIYUAN_SETTINGS_INTERFACE, revision);
            } catch (error) {
                log("settings dialog failed to receive switch notification: " + error);
            }
        }
        return revision;
    };
    const release = (approved: ApprovedWindow): void => {
        clearTimeout(approved.timer);
        const pendingKey = approved.owner.id + ":" + approved.frameName;
        if (pending.get(pendingKey) === approved) pending.delete(pendingKey);
        if (registry.get(approved.key) === approved) registry.delete(approved.key);
    };
    const finish = (approved: ApprovedWindow, ownerInvalidated = false): void => {
        if (!approved.active) return;
        approved.active = false;
        release(approved);
        owners.get(approved.owner)?.records.delete(approved);
        if (!approved.owner.isDestroyed()) {
            try {
                approved.owner.send(Channel.SIYUAN_SETTINGS_CLOSED, approved.data.token, ownerInvalidated);
            } catch (error) {
                log("settings owner failed to receive close notification: " + error);
            }
        }
    };
    const cancel = (approved: ApprovedWindow, ownerInvalidated = false): void => {
        finish(approved, ownerInvalidated);
        const win = approved.win;
        if (win && !win.isDestroyed()) {
            if (ownerInvalidated) {
                // 导航回调内同步销毁子窗口会阻塞 Windows 原生消息循环，授权仍须立即失效。
                setImmediate(() => {
                    if (!win.isDestroyed()) win.destroy();
                });
            } else {
                win.destroy();
            }
        }
    };
    const watchOwner = (owner: WebContents): OwnerState => {
        let state = owners.get(owner);
        if (state) return state;
        state = {records: new Set<ApprovedWindow>()};
        owners.set(owner, state);
        const invalidate = () => {
            for (const approved of [...state.records]) cancel(approved, true);
        };
        owner.on("did-start-navigation", (details: WebContentsDidStartNavigationEventParams) => {
            if (details.isMainFrame && !details.isSameDocument) invalidate();
        });
        owner.on("render-process-gone", invalidate);
        owner.once("destroyed", invalidate);
        // Electron 为 webContents 提供该事件，但类型声明只在 BrowserWindow 上列出。
        const createdWindowOwner = owner as unknown as {
            on: (eventName: "did-create-window",
                listener: (win: BrowserWindow, details: HandlerDetails) => void) => void;
        };
        createdWindowOwner.on("did-create-window", (win: BrowserWindow, details: HandlerDetails) => {
            const approved = [...state.records].find(item => item.url === details.url && item.created);
            if (approved) {
                approved.created?.(win);
                return;
            }
            // 授权失效后才创建的子窗口不能继续使用旧文档的宿主。
            try {
                const url = new URL(details.url);
                if (url.pathname === settingsPath && url.searchParams.has("settingsWindowToken")) win.destroy();
            } catch {
                return;
            }
        });
        return state;
    };
    // 按创建后的窗口反查授权记录，只有已创建的窗口才会登记 win。
    const findApprovedWindow = (contents: WebContents): ApprovedWindow | undefined => {
        for (const approved of registry.values()) {
            if (approved.win && !approved.win.isDestroyed() && approved.win.webContents === contents) return approved;
        }
    };
    electron.ipcMain.on(Channel.SIYUAN_SETTINGS_READY, (event: IpcMainEvent) => {
        if (event.senderFrame !== event.sender.mainFrame) return;
        const approved = findApprovedWindow(event.sender);
        if (!approved) return;
        approved.ready = true;
        approved.reveal?.();
    });
    electron.ipcMain.on(Channel.SIYUAN_SETTINGS_CLOSE_SELF, (event: IpcMainEvent) => {
        if (event.senderFrame !== event.sender.mainFrame) return;
        const approved = findApprovedWindow(event.sender);
        if (approved) cancel(approved);
    });
    electron.ipcMain.on(Channel.SIYUAN_SETTINGS_CLOSE, (event: IpcMainEvent, data: SettingsWindowData) => {
        const target = getTarget(event.sender.id);
        if (!target || event.senderFrame !== event.sender.mainFrame || !data ||
            !SETTINGS_KEY_PATTERN.test(data.key) ||
            !SETTINGS_TOKEN_PATTERN.test(data.token)) return;
        const registryKey = `${target.origin}:${data.key === "builtin" ? "builtin" : event.sender.id + ":" + data.key}`;
        const approved = registry.get(registryKey);
        if (approved && approved.owner === event.sender && approved.data.token === data.token) cancel(approved);
    });
    electron.ipcMain.on(Channel.SIYUAN_SETTINGS_OPEN_DIALOG, (event: IpcMainEvent) => {
        // 未通过校验的发送方返回 false：渲染进程据此放弃打开设置，而数字会被当作合法序号接受。
        let revision: number | false = false;
        try {
            const target = getSettingTarget(event);
            if (!target) return;
            // 内置设置按工作区互斥，插件专属窗口仍通过所属宿主及令牌关闭。
            const existing = registry.get(`${target.origin}:builtin`);
            if (existing) cancel(existing);
            revision = notifySettingDialogs(target);
        } finally {
            event.returnValue = revision;
        }
    });
    electron.ipcMain.handle(Channel.SIYUAN_SETTINGS_PREPARE, (event: IpcMainInvokeEvent, data: SettingsWindowData) => {
        const requestedAt = Date.now();
        const target = getSettingTarget(event);
        if (!target || !data ||
            !SETTINGS_TOKEN_PATTERN.test(data.token) ||
            !SETTINGS_KEY_PATTERN.test(data.key)) {
            return {create: false};
        }
        const key = `${target.origin}:${data.key === "builtin" ? "builtin" : event.sender.id + ":" + data.key}`;
        const existing = registry.get(key);
        if (existing?.win && !existing.win.isDestroyed()) {
            if (data.key === "builtin") notifySettingDialogs(target, existing.revision);
            existing.data.command = data.command;
            existing.win.webContents.send(Channel.SIYUAN_SETTINGS_COMMAND, data.command);
            if (existing.shown) show(existing.win);
            return {create: false, revision: existing.revision};
        }
        if (existing && !existing.win && existing.expires >= Date.now() && !existing.owner.isDestroyed()) {
            if (data.key === "builtin") notifySettingDialogs(target, existing.revision);
            existing.data.command = data.command;
            return {create: false, revision: existing.revision};
        }
        if (existing) cancel(existing);
        const revision = data.key === "builtin" ? notifySettingDialogs(target) : undefined;
        const url = new URL(settingsPath, target.origin);
        url.searchParams.set("settingsWindowToken", data.token);
        if (target.mode === "remote") {
            url.searchParams.set("remote", "1");
        }
        const frameName = "siyuan-settings-" + data.token;
        const approved: ApprovedWindow = {key, target, owner: event.sender, url: url.href, frameName, data,
            requestedAt, revision, active: true, expires: Date.now() + SETTINGS_APPROVAL_TTL_MS, ready: false, painted: false, shown: false};
        watchOwner(event.sender).records.add(approved);
        approved.timer = setTimeout(() => cancel(approved), SETTINGS_APPROVAL_TTL_MS);
        approved.timer.unref();
        pending.set(event.sender.id + ":" + frameName, approved);
        registry.set(key, approved);
        return {create: true, token: data.token, url: approved.url, frameName, revision};
    });
    // 打开请求先登记为 pending，真正建窗时才接线；来源、地址或帧名不符时本策略不接管。
    const takePendingApproval = (contents: WebContents, details: HandlerDetails): ApprovedWindow | undefined => {
        const pendingKey = contents.id + ":" + details.frameName;
        const approved = pending.get(pendingKey);
        if (!approved || approved.expires < Date.now() || details.url !== approved.url ||
            details.frameName !== approved.frameName) {
            return undefined;
        }
        pending.delete(pendingKey);
        return approved;
    };

    // 放行的窗口按授权记录决定外观：标题、标题栏高度与几何都来自该次请求。
    const approvedWindowOptions = (approved: ApprovedWindow): BrowserWindowConstructorOptions => ({
        show: false,
        title: approved.data.title || "SiYuan",
        frame: platform === "darwin",
        titleBarStyle: "hidden",
        titleBarOverlay: getTitleBarOverlayOptions(platform, getCaptionHeight(approved.data.compactMode, false)),
        trafficLightPosition: {x: 8, y: 8},
        autoHideMenuBar: true,
        fullscreenable: true,
        icon,
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        width: 1000,
        height: 760,
        ...normalizeWindowGeometry(approved.data.geometry, electron.screen),
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            nodeIntegrationInSubFrames: false,
            nodeIntegrationInWorker: false,
            webviewTag: approved.target.mode !== "remote",
            webSecurity: approved.target.mode === "remote",
            // 首次显示前保持帧和定时器正常调度，显示后恢复后台节流。
            backgroundThrottling: false,
        },
    });

    const bindRevealOnFirstPaint = (approved: ApprovedWindow, win: BrowserWindow): void => {
        approved.reveal = () => {
            if (!shouldReveal(approved, win)) return;
            approved.shown = true;
            if (approved.data.geometry?.maximized) win.maximize();
            show(win);
            win.webContents.setBackgroundThrottling(true);
            win.webContents.send(Channel.SIYUAN_SETTINGS_SHOWN);
            log("settings window revealed [" + (Date.now() - approved.requestedAt) + "ms since open request]");
        };
        win.once("ready-to-show", () => {
            approved.painted = true;
            approved.reveal?.();
        });
    };

    // 内置设置把窗口几何回传给宿主界面；连续变化合并，关闭时立即保存最终状态。
    const bindGeometryPersistence = (approved: ApprovedWindow, win: BrowserWindow, owner: WebContents): void => {
        let geometryTimer: NodeJS.Timeout | undefined;
        let lastGeometry: Record<string, unknown> | undefined;
        const saveGeometry = () => {
            clearTimeout(geometryTimer);
            if (!approved.active || win.isDestroyed() || owner.isDestroyed()) return;
            const geometry = captureWindowGeometry(win);
            const geometryKeys = Object.keys(geometry) as (keyof typeof geometry)[];
            const previous = lastGeometry;
            if (previous && geometryKeys.every(key => geometry[key] === previous[key])) return;
            owner.send(Channel.SIYUAN_SETTINGS_GEOMETRY, geometry);
            lastGeometry = geometry;
        };
        const geometryWindow = win as unknown as {
            on: (eventName: "resize" | "move" | "maximize" | "unmaximize", listener: () => void) => void;
        };
        for (const event of ["resize", "move", "maximize", "unmaximize"] as const) {
            geometryWindow.on(event, () => {
                clearTimeout(geometryTimer);
                geometryTimer = setTimeout(saveGeometry, 300);
            });
        }
        win.on("close", saveGeometry);
        win.once("closed", () => clearTimeout(geometryTimer));
    };

    // 设置在 macOS 上保留原生菜单，其他平台去掉窗口菜单；两者都支持打开开发者工具。
    const bindWindowChrome = (win: BrowserWindow): void => {
        if (platform !== "darwin") win.setMenu(null);
        win.webContents.on("before-input-event", (event: ElectronEvent, input: Input) => {
            if (input.type === "keyDown" && !input.isAutoRepeat && isDevToolsShortcut(input, platform)) {
                event.preventDefault();
                toggleDevTools(win.webContents, platform);
            }
        });
    };

    const initializeApprovedWindow = (approved: ApprovedWindow, win: BrowserWindow, owner: WebContents): void => {
        approved.created = undefined;
        approved.win = win;
        release(approved);
        registry.set(approved.key, approved);
        bindRevealOnFirstPaint(approved, win);
        bindWindowChrome(win);
        win.once("closed", () => finish(approved));
        if (approved.data.key === "builtin") {
            bindGeometryPersistence(approved, win, owner);
        }
        win.webContents.once("did-finish-load", () => {
            if (approved.active) win.webContents.send(Channel.SIYUAN_SETTINGS_COMMAND, approved.data.command);
        });
        win.webContents.on("did-fail-load", (_event: ElectronEvent, code: number, description: string,
            _url: string, isMainFrame: boolean) => {
            if (code !== -3) log("settings window failed to load: " + description);
            if (code !== -3 && isMainFrame) cancel(approved);
        });
        win.webContents.once("render-process-gone", () => cancel(approved));
        try {
            initialize(win, approved.target);
        } catch (error) {
            cancel(approved);
            log("settings window failed to initialize: " + error);
        }
    };

    return (contents: WebContents, details: HandlerDetails): WindowOpenHandlerResponse | undefined => {
        const approved = takePendingApproval(contents, details);
        if (!approved) {
            return undefined;
        }
        approved.created = (win: BrowserWindow): void => initializeApprovedWindow(approved, win, contents);
        return {action: "allow", overrideBrowserWindowOptions: approvedWindowOptions(approved)};
    };
};

export {createSettingsWindows};
