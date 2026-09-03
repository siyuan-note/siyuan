// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// 开发环境下隐藏 Electron 安全清单控制台提示 https://www.electronjs.org/docs/latest/tutorial/security
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

const {
    net,
    app,
    BrowserWindow,
    Notification,
    shell,
    session,
    Menu,
    MenuItem,
    screen,
    ipcMain,
    clipboard,
    globalShortcut,
    Tray,
    dialog,
    systemPreferences,
    powerMonitor
} = require("electron");
const path = require("path");
const fs = require("fs");
const {pathToFileURL} = require("url");
const gNet = require("net");
const childProcess = require("child_process");
const remote = require("@electron/remote/main");
const {
    getAppleSiliconDownloadURL,
    shouldDownloadAppleSilicon,
    shouldShowAppleSiliconWarning,
} = require("./appleSilicon");
const {
    createRemoteDocumentContentSecurityPolicy,
    getArgFrom,
    getRemoteKernelRedirectDecision,
    getRemoteKernelRequestPolicy,
    getRemoteKernelWebRequestDestination,
    getRemoteKernelVersionStatus,
    getUnsafeRemoteChromiumSwitchName,
    isAllowedRemoteExternalURL,
    normalizeRemoteKernelOrigin,
    remoteKernelActiveStorageTypes,
    shouldBlockRemoteFrameNavigation,
    shouldForwardRemoteDeepLink,
    shouldTrustLocalKernelCertificate,
    unsafeRemoteChromiumSwitchNames,
} = require("./remoteKernel");

process.noAsar = true;
const appDir = path.dirname(app.getAppPath());
const isDevEnv = process.env.NODE_ENV === "development";
const simulateRosetta = process.argv.includes("--simulate-rosetta");
const appVer = app.getVersion();
const confDir = path.join(app.getPath("home"), ".config", "siyuan");
const windowStatePath = path.join(confDir, "windowState.json");
const appCrashLogPath = path.join(confDir, "app.crash.log");
const appCrashMarkerPath = path.join(confDir, "app.crash.json");
const systemShutdownNone = 0;
const systemShutdownEnding = 1;
const systemShutdownForced = 2;
const systemShutdownExitTimeout = 30000;
const updateKernelExitTimeout = 30000;
const safeModeReasons = new Set(["abnormal-exit", "killed", "crashed", "oom", "memory-eviction"]);
const noSafeModeReasons = new Set(["clean-exit", "launch-failed", "integrity-failure"]);
const expectedRendererExitIds = new Set();
const expectedKernelExitPorts = new Set();
const handledCrashWebContents = new Set();
const kernelProcesses = new Map();
let bootWindow;
let bootIndexPath;
let bootAppearanceFallback = false;
let latestActiveWindow;
let firstOpen = false;
let workspaces = []; // workspaceDir, id, port, webContentsId, browserWindow, tray, hideShortcut
const windowKernelTargets = new Map();
const initializedWindowIds = new Set();
const pendingRemoteOpenURLs = [];

const flushPendingRemoteOpenURLs = (window) => {
    if (!window || window.isDestroyed()) {
        return;
    }
    pendingRemoteOpenURLs.splice(0).forEach((url) => window.webContents.send("siyuan-open-url", url));
};

const getGlobalShortcutWorkspace = (fallbackWorkspace) => {
    const focusedWorkspace = workspaces.find(item => item.browserWindow &&
        !item.browserWindow.isDestroyed() && item.browserWindow.isFocused());
    if (focusedWorkspace) {
        return focusedWorkspace;
    }
    if (fallbackWorkspace?.browserWindow && !fallbackWorkspace.browserWindow.isDestroyed()) {
        return fallbackWorkspace;
    }
};
const initEventId = [];
const appMenuByWorkspaceDir = new Map();
const appMenuWorkspaceByWebContentsId = new Map();
let kernelPort = 6806;
let resetWindowStateOnRestart = false;
let openAsHidden = false;
let systemShutdownState = systemShutdownNone;
let gracefulSystemShutdownPromise;
let keepAppOpenDuringSystemShutdown = false;
let updateInstallPromise;
let keepAppOpenDuringUpdate = false;
let richClipboardOperation;
let richClipboardSequence = 0;
let appleSiliconWarningShown = false;
const openDialogSingletons = new Set();
let spellcheckContextSequence = 0;
const spellcheckContexts = new Map();
const pendingSpellcheckRequests = new Map();
const pendingNativeContextMenuRequests = new Map();
const spellcheckContextMenuContents = new Set();
const normalizeClipboardText = (text) => text.replace(/\r\n?/g, "\n");
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
})[character]);
const isOpenAsHidden = function () {
    return 1 === workspaces.length && openAsHidden;
};

const getArg = (name) => getArgFrom(process.argv, name);

const createLocalKernelTarget = (port = kernelPort) => ({
    mode: "local",
    origin: "https://127.0.0.1:" + port,
    ownsKernel: true,
    port: port.toString(),
});

let remoteKernelTarget;
let remoteKernelArgError;
const remoteKernelArg = getArg("--remote");
if (remoteKernelArg !== undefined) {
    try {
        const origin = normalizeRemoteKernelOrigin(remoteKernelArg);
        remoteKernelTarget = {
            mode: "remote",
            origin,
            ownsKernel: false,
            port: "",
        };
    } catch (error) {
        remoteKernelArgError = error;
    }
}

if (remoteKernelTarget) {
    const configuredUnsafeSwitchNames = new Set(process.argv.map(getUnsafeRemoteChromiumSwitchName).filter(Boolean));
    unsafeRemoteChromiumSwitchNames.forEach((switchName) => {
        if (app.commandLine.hasSwitch(switchName)) {
            configuredUnsafeSwitchNames.add(switchName);
        }
    });
    const disabledFeatures = app.commandLine.getSwitchValue("disable-features");
    if (getUnsafeRemoteChromiumSwitchName("--disable-features=" + disabledFeatures)) {
        configuredUnsafeSwitchNames.add("disable-features");
    }
    if (configuredUnsafeSwitchNames.size > 0) {
        configuredUnsafeSwitchNames.forEach((switchName) => app.commandLine.removeSwitch(switchName));
        remoteKernelArgError = new Error("--remote cannot be combined with switches that weaken web security: " +
            Array.from(configuredUnsafeSwitchNames).join(", "));
        remoteKernelArgError.code = "ERR_REMOTE_UNSAFE_CHROMIUM_SWITCH";
    }
}

const initialSiYuanOpenURL = process.argv.find((arg) => arg.startsWith("siyuan://"));
if (remoteKernelTarget && !remoteKernelArgError && initialSiYuanOpenURL) {
    pendingRemoteOpenURLs.push(initialSiYuanOpenURL);
}

const isMatchingContextMenuRequest = (context, request) => {
    return Number.isFinite(request.requestedAt) &&
        context.createdAt >= request.requestedAt &&
        context.createdAt - request.requestedAt < 1000;
};

const popupNativeTextContextMenu = (contents, context, request) => {
    const params = context?.params;
    const template = [];
    if (params?.misspelledWord) {
        params.dictionarySuggestions.forEach((suggestion) => {
            template.push(new MenuItem({
                label: suggestion,
                click: () => contents.replaceMisspelling(suggestion),
            }));
        });
        template.push(new MenuItem({
            label: request.addToDictionary,
            click: () => {
                if (!contents.session.addWordToSpellCheckerDictionary(params.misspelledWord)) {
                    writeLog("failed to add word to spell checker dictionary");
                }
            },
        }), {type: "separator"});
    }
    template.push(new MenuItem({
        role: "undo", label: request.undo
    }), new MenuItem({
        role: "redo", label: request.redo
    }), {type: "separator"}, new MenuItem({
        role: "copy", label: request.copy
    }), new MenuItem({
        role: "cut", label: request.cut
    }), new MenuItem({
        role: "delete", label: request.delete
    }), new MenuItem({
        role: "paste", label: request.paste
    }), new MenuItem({
        role: "pasteAndMatchStyle", label: request.pasteAsPlainText
    }), new MenuItem({
        role: "selectAll", label: request.selectAll
    }));
    const menu = Menu.buildFromTemplate(template);
    const options = {
        window: BrowserWindow.fromWebContents(contents),
    };
    if (params) {
        options.x = params.x;
        options.y = params.y;
        options.sourceType = params.menuSourceType;
        if (params.frame) {
            options.frame = params.frame;
        }
    }
    menu.popup(options);
};

const dispatchContextMenuRequests = (contents) => {
    const context = spellcheckContexts.get(contents.id);
    if (!context || context.delivered) {
        return;
    }
    const spellcheckRequest = pendingSpellcheckRequests.get(contents.id);
    if (spellcheckRequest && isMatchingContextMenuRequest(context, spellcheckRequest)) {
        context.delivered = true;
        pendingSpellcheckRequests.delete(contents.id);
        contents.send("siyuan-spellcheck-context", {
            contextId: context.contextId,
            x: spellcheckRequest.x,
            y: spellcheckRequest.y,
            misspelledWord: context.params.misspelledWord,
            dictionarySuggestions: context.params.dictionarySuggestions,
        });
        return;
    }
    const nativeRequest = pendingNativeContextMenuRequests.get(contents.id);
    if (nativeRequest && isMatchingContextMenuRequest(context, nativeRequest)) {
        context.delivered = true;
        pendingNativeContextMenuRequests.delete(contents.id);
        popupNativeTextContextMenu(contents, context, nativeRequest);
    }
};

const bindSpellcheckContextMenu = (contents) => {
    if (spellcheckContextMenuContents.has(contents.id)) {
        return;
    }
    spellcheckContextMenuContents.add(contents.id);
    contents.on("context-menu", (event, params) => {
        const context = {
            contextId: ++spellcheckContextSequence,
            params,
            createdAt: Date.now(),
            delivered: false,
        };
        spellcheckContexts.set(contents.id, context);
        dispatchContextMenuRequests(contents);
        setTimeout(() => {
            if (spellcheckContexts.get(contents.id) === context && !context.delivered) {
                spellcheckContexts.delete(contents.id);
            }
        }, 200);
    });
    contents.once("destroyed", () => {
        spellcheckContextMenuContents.delete(contents.id);
        spellcheckContexts.delete(contents.id);
        pendingSpellcheckRequests.delete(contents.id);
        pendingNativeContextMenuRequests.delete(contents.id);
    });
};

remote.initialize();

// Electron 相关文件夹名称改为 `SiYuan-Electron` https://github.com/siyuan-note/siyuan/issues/3349
// getPath("userData") 会创建空的 SiYuan 目录，改为 app.getPath("appData")
app.setPath("userData", path.join(app.getPath("appData"), app.getName() + "-Electron"));

if (process.platform === "win32") {
    // Windows 需要设置 AppUserModelId 才能正确显示应用名称和应用图标 https://github.com/siyuan-note/siyuan/issues/17022
    app.setAppUserModelId("org.b3log.siyuan");
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
}

// 开发环境下 Windows 需显式传入 Electron 可执行文件路径和 main.js 路径，否则 siyuan:// 会被当作相对路径
if (isDevEnv && process.defaultApp && process.argv.length >= 2) {
    const mainScript = path.resolve(process.argv[1]);
    if (process.platform === "win32") {
        app.removeAsDefaultProtocolClient("siyuan", process.execPath, [mainScript]);
        app.setAsDefaultProtocolClient("siyuan", process.execPath, [mainScript]);
    } else {
        app.setAsDefaultProtocolClient("siyuan");
    }
} else {
    app.setAsDefaultProtocolClient("siyuan");
}

app.commandLine.appendSwitch("auto-detect", "false");
if (!remoteKernelTarget) {
    app.commandLine.appendSwitch("disable-web-security");
    app.commandLine.appendSwitch("no-proxy-server");
}
app.commandLine.appendSwitch("enable-features", "PlatformHEVCDecoderSupport");
app.commandLine.appendSwitch("xdg-portal-required-version", "4");
// 本地 HTTPS 页面加载 HTTP 外链图时，禁止自动升级为 HTTPS
app.commandLine.appendSwitch("disable-features", "AutoupgradeMixedContent");

// Support set Chromium command line arguments on the desktop https://github.com/siyuan-note/siyuan/issues/9696
writeLog("app is packaged [" + app.isPackaged + "], command line args [" + process.argv.join(", ") + "]");
let argStart = 1;
if (!app.isPackaged) {
    argStart = 2;
}

for (let i = argStart; i < process.argv.length; i++) {
    let arg = process.argv[i];
    if (arg.startsWith("--workspace=") || arg.startsWith("--openAsHidden") || arg.startsWith("--port=") ||
        arg.startsWith("--safe-mode=") || arg.startsWith("--lang=") || arg === "--remote" ||
        arg.startsWith("--remote=") ||
        arg.startsWith("siyuan://")) {
        // 跳过内置参数
        if (arg.startsWith("--openAsHidden")) {
            openAsHidden = true;
            writeLog("open as hidden");
        }
        continue;
    }

    if (remoteKernelTarget && getUnsafeRemoteChromiumSwitchName(arg)) {
        continue;
    }

    app.commandLine.appendSwitch(arg);
    writeLog("command line switch [" + arg + "]");
}

try {
    firstOpen = !remoteKernelTarget && !fs.existsSync(path.join(confDir, "workspace.json"));
    if (!fs.existsSync(confDir)) {
        fs.mkdirSync(confDir, {mode: 0o755, recursive: true});
    }
} catch (e) {
    console.error(e);
    require("electron").dialog.showErrorBox("创建配置目录失败 Failed to create config directory", "思源需要在用户家目录下创建配置文件夹（~/.config/siyuan），请确保该路径具有写入权限。\n\nSiYuan needs to create a configuration folder (~/.config/siyuan) in the user's home directory. Please make sure that the path has write permissions.");
    app.exit();
}

// 检测上次打开的工作空间是否丢失 https://github.com/siyuan-note/siyuan/issues/14748
let lastWorkspaceMissing = false;
let missingWorkspacePath = "";
let availableWorkspaces = [];
if (!remoteKernelTarget && !firstOpen && !getArg("--workspace")) {
    // 显式通过命令行指定工作空间时尊重用户参数，跳过检测
    try {
        const wsFile = path.join(confDir, "workspace.json");
        if (fs.existsSync(wsFile)) {
            const wsList = JSON.parse(fs.readFileSync(wsFile, "utf8"));
            if (Array.isArray(wsList) && 0 < wsList.length) {
                const last = wsList[wsList.length - 1];
                if (!fs.existsSync(last) || !fs.statSync(last).isDirectory()) {
                    lastWorkspaceMissing = true;
                    missingWorkspacePath = last;
                    availableWorkspaces = wsList.slice(0, -1).filter(p =>
                        fs.existsSync(p) && fs.statSync(p).isDirectory());
                }
            }
        }
    } catch (e) {
        writeLog("check missing workspace failed: " + e);
    }
}

// 读取上次打开的工作空间路径，用于崩溃恢复时默认选中该工作空间
let lastWorkspacePath = "";
if (!remoteKernelTarget && !firstOpen && !getArg("--workspace")) {
    try {
        const wsFile = path.join(confDir, "workspace.json");
        if (fs.existsSync(wsFile)) {
            const wsList = JSON.parse(fs.readFileSync(wsFile, "utf8"));
            if (Array.isArray(wsList) && 0 < wsList.length) {
                lastWorkspacePath = wsList[wsList.length - 1];
            }
        }
    } catch (e) {
        writeLog("read last workspace path failed: " + e);
    }
}

const openExternalURL = (url, remoteMode = false) => {
    if (remoteMode && !isAllowedRemoteExternalURL(url)) {
        writeLog("blocked external protocol in remote kernel mode [url=" + url + "]");
        return;
    }
    shell.openExternal(url);
};

const windowNavigate = (currentWindow, windowType, kernelOrigin, remoteMode = false) => {
    currentWindow.webContents.on("will-navigate", (event) => {
        try {
            const targetURL = new URL(event.url);
            if (targetURL.origin === kernelOrigin && (
                windowType === "app" && ["/stage/build/app/", "/check-auth"].includes(targetURL.pathname) ||
                windowType === "app" && !remoteMode && targetURL.pathname === "/" ||
                windowType === "window" && ["/stage/build/app/window.html", "/check-auth"].includes(targetURL.pathname) ||
                windowType === "export" && targetURL.pathname.startsWith("/export/temp/")
            )) {
                return;
            }
        } catch (e) {
            // 无效链接交给系统浏览器处理。
        }
        // 其他链接使用浏览器打开
        event.preventDefault();
        openExternalURL(event.url, remoteMode);
    });
};

const getWindowPathname = (window) => {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
        return "";
    }
    try {
        return new URL(window.webContents.getURL()).pathname;
    } catch (error) {
        return "";
    }
};

const setProxy = (proxyURL, webContents, proxyMode) => {
    if (proxyMode === "system" || (!proxyMode && proxyURL.startsWith("://"))) {
        console.log("network proxy [system]");
        return webContents.session.setProxy({mode: "system"});
    }
    if (proxyMode === "direct") {
        console.log("network proxy [direct]");
        return webContents.session.setProxy({mode: "direct"});
    }
    console.log("network proxy [" + proxyURL + "]");
    return webContents.session.setProxy({proxyRules: proxyURL});
};

const hotKey2Electron = (key) => {
    if (!key) {
        return key;
    }
    let electronKey = "";
    if (key.indexOf("⌘") > -1) {
        electronKey += "CommandOrControl+";
    }
    if (key.indexOf("⌃") > -1) {
        electronKey += "Control+";
    }
    if (key.indexOf("⇧") > -1) {
        electronKey += "Shift+";
    }
    if (key.indexOf("⌥") > -1) {
        electronKey += "Alt+";
    }
    return electronKey + key.replace("⌘", "").replace("⇧", "").replace("⌥", "").replace("⌃", "")
        .replace("←", "Left").replace("→", "Right").replace("↑", "Up").replace("↓", "Down").replace(" ", "Space")
        .replace("+", "Plus").replace("⇥", "Tab").replace("⌫", "Backspace").replace("⌦", "Delete").replace("↩", "Return");
};

const getFeedbackUrl = (lang) => {
    return "zh-CN" === lang
        ? "https://ld246.com/article/1649901726096"
        : "https://liuyun.io/article/1686530886208";
};

const withHotkey = (hotkey, overrideRoleDefault = false) => {
    if (typeof hotkey !== "string" || !hotkey.length) {
        // 空快捷键：自定义项不注册加速键；role 项需显式覆盖系统默认加速键
        return overrideRoleDefault ? {accelerator: "", registerAccelerator: false} : {};
    }
    const acc = hotKey2Electron(hotkey);
    return acc ? {accelerator: acc} : (overrideRoleDefault ? {accelerator: "", registerAccelerator: false} : {});
};

const forgetAppMenuWebContents = (webContentsId) => {
    const workspaceDir = appMenuWorkspaceByWebContentsId.get(webContentsId);
    appMenuWorkspaceByWebContentsId.delete(webContentsId);
    const initIndex = initEventId.indexOf(webContentsId);
    if (initIndex > -1) {
        initEventId.splice(initIndex, 1);
    }
    if (!workspaceDir) {
        return;
    }
    for (const mappedDir of appMenuWorkspaceByWebContentsId.values()) {
        if (mappedDir === workspaceDir) {
            return;
        }
    }
    appMenuByWorkspaceDir.delete(workspaceDir);
};

const isInitializedAppWindow = (wnd) => {
    return !!(wnd && !wnd.isDestroyed() && initEventId.includes(wnd.webContents.id));
};

const getAppWindow = () => {
    const focused = BrowserWindow.getFocusedWindow();
    if (isInitializedAppWindow(focused)) {
        return focused;
    }
    if (isInitializedAppWindow(latestActiveWindow)) {
        return latestActiveWindow;
    }
    const workspaceWindow = workspaces.find((item) => isInitializedAppWindow(item.browserWindow));
    if (workspaceWindow) {
        return workspaceWindow.browserWindow;
    }
    return BrowserWindow.getAllWindows().find(isInitializedAppWindow) || null;
};

const setNonDarwinApplicationMenu = () => {
    const productName = "SiYuan";
    const template = [{
        label: productName, submenu: [{
            label: `About ${productName}`, role: "about",
        }, {type: "separator"}, {role: "services"}, {type: "separator"}, {
            label: `Hide ${productName}`, role: "hide",
        }, {role: "hideOthers"}, {role: "unhide"}, {type: "separator"}, {
            label: `Quit ${productName}`, role: "quit",
        },],
    }, {
        role: "editMenu", submenu: [{role: "cut"}, {role: "copy"}, {role: "paste"}, {role: "selectAll"}],
    }, {
        role: "windowMenu",
        submenu: [{role: "minimize"}, {role: "zoom"}, {role: "togglefullscreen"}, {type: "separator"}, {role: "toggledevtools"}, {type: "separator"}, {role: "front"},],
    },];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const applyMacAppMenu = (sync) => {
    if ("darwin" !== process.platform || !sync || !sync.i18n || typeof sync.i18n !== "object" ||
        !sync.hotkey || typeof sync.hotkey !== "object") {
        return;
    }
    /** @type {import("electron").MenuItemConstructorOptions[]} */
    const template = [{
        role: "appMenu",
        label: app.name,
        submenu: [
            {role: "about", label: sync.i18n.about || "About SiYuan"},
            ...(sync.readonly ? [] : [{
                label: sync.i18n.config || "Settings",
                click: () => {
                    getAppWindow()?.webContents.send("siyuan-open-setting");
                },
                ...withHotkey(sync.hotkey.config),
            }]),
            {type: "separator"},
            {role: "services", label: sync.i18n.services || "Services"},
            {type: "separator"},
            {
                label: sync.i18n.toggleMainWindow || "Hide/Show Window",
                click: () => {
                    toggleMainWindow(getAppWindow());
                },
                ...withHotkey(sync.hotkey.toggleWin),
            },
            {role: "hide", label: sync.i18n.hide || "Hide SiYuan"},
            {role: "hideOthers", label: sync.i18n.hideOthers || "Hide Others"},
            {role: "unhide", label: sync.i18n.showAll || "Show All"},
            {type: "separator"},
            {role: "quit", label: sync.i18n.quit || "Quit SiYuan"},
        ],
    }, {
        role: "editMenu",
        label: sync.i18n.edit || "Edit",
        submenu: [
            {role: "undo", label: sync.i18n.undo || "Undo", ...withHotkey(sync.hotkey.undo, true)},
            {role: "redo", label: sync.i18n.redo || "Redo", ...withHotkey(sync.hotkey.redo, true)},
            {type: "separator"},
            {role: "cut", label: sync.i18n.cut || "Cut"},
            {role: "copy", label: sync.i18n.copy || "Copy"},
            {role: "paste", label: sync.i18n.paste || "Paste"},
            {role: "pasteAndMatchStyle", label: sync.i18n.pasteAndMatchStyle || "Paste and Match Style"},
            {type: "separator"},
            {role: "selectAll", label: sync.i18n.selectAll || "Select All"},
        ],
    }, {
        role: "windowMenu",
        label: sync.i18n.window || "Window",
        submenu: [
            {role: "minimize", label: sync.i18n.minimize || "Minimize"},
            {role: "zoom", label: sync.i18n.zoom || "Zoom"},
            {role: "togglefullscreen", label: sync.i18n.togglefullscreen || "Toggle Full Screen"},
            {type: "separator"},
            {
                label: sync.i18n.bringAllToFront || "Bring All to Front",
                click: () => {
                    const windows = BrowserWindow.getAllWindows();
                    windows.forEach(showWindow);
                    const target = (latestActiveWindow && !latestActiveWindow.isDestroyed() && windows.includes(latestActiveWindow))
                        ? latestActiveWindow
                        : windows[0];
                    target?.focus();
                },
            },
        ],
    }, {
        role: "help",
        label: sync.i18n.help || "Help",
        submenu: [
            ...(sync.readonly ? [] : [{
                label: sync.i18n.userGuide || "User Guide",
                click: () => {
                    getAppWindow()?.webContents.send("siyuan-open-help");
                },
            }]),
            {
                label: sync.i18n.feedback || "Feedback",
                click: () => {
                    shell.openExternal(getFeedbackUrl(sync.lang));
                },
            },
            {
                label: sync.i18n.officialWebsite || "Visit official website",
                click: () => {
                    shell.openExternal("https://b3log.org/siyuan");
                },
            },
            {
                label: sync.i18n.openSource || "Visit project on GitHub",
                click: () => {
                    shell.openExternal("https://github.com/siyuan-note/siyuan");
                },
            },
            {role: "toggledevtools", label: sync.i18n.debug || "Developer Tools"},
        ],
    }];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const applyMacAppMenuForWindow = (wnd) => {
    if ("darwin" !== process.platform || !wnd || wnd.isDestroyed()) {
        return;
    }
    const workspaceDir = appMenuWorkspaceByWebContentsId.get(wnd.webContents.id);
    if (!workspaceDir) {
        return;
    }
    applyMacAppMenu(appMenuByWorkspaceDir.get(workspaceDir));
};

const shouldApplyAppMenuFrom = (webContentsId, workspaceDir) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (isInitializedAppWindow(focused)) {
        if (focused.webContents.id === webContentsId) {
            return true;
        }
        return appMenuWorkspaceByWebContentsId.get(focused.webContents.id) === workspaceDir;
    }
    if (isInitializedAppWindow(latestActiveWindow)) {
        if (latestActiveWindow.webContents.id === webContentsId) {
            return true;
        }
        const latestWorkspace = appMenuWorkspaceByWebContentsId.get(latestActiveWindow.webContents.id);
        return !latestWorkspace || latestWorkspace === workspaceDir;
    }
    return true;
};

/**
 * 将 RFC 5646 格式的语言标签解析为应用支持的语言代码
 * https://www.rfc-editor.org/info/rfc5646
 * @param {string[]} languageTags - 语言标签数组（如 ["zh-Hans-CN", "en-US"]）
 * @returns {string} 应用支持的语言代码
 */
const resolveAppLanguage = (languageTags) => {
    if (!languageTags || languageTags.length === 0) {
        return "en";
    }

    const tag = languageTags[0].toLowerCase();
    const parts = tag.replace(/_/g, "-").split("-");
    const language = parts[0];

    if (language === "zh") {
        if (tag.includes("hant")) {
            return "zh-TW";
        }
        if (tag.includes("hans") || tag.includes("cn") || tag.includes("sg")) {
            return "zh-CN";
        }
        if (tag.includes("tw") || tag.includes("hk") || tag.includes("mo")) {
            return "zh-TW";
        }
        return "zh-CN";
    }

    const languageMapping = {
        "en": "en",
        "ar": "ar",
        "de": "de",
        "es": "es",
        "fr": "fr",
        "he": "he",
        "hi": "hi",
        "id": "id",
        "it": "it",
        "ja": "ja",
        "ko": "ko",
        "nl": "nl",
        "pl": "pl",
        "pt": "pt-BR",
        "ru": "ru",
        "sk": "sk",
        "th": "th",
        "tr": "tr",
        "uk": "uk",
    };

    return languageMapping[language] || "en";
};

const loadAppleSiliconWarningLanguages = (requestedLanguage) => {
    const language = resolveAppLanguage(requestedLanguage ? [requestedLanguage] : app.getPreferredSystemLanguages());
    const languageDir = path.join(appDir, "appearance", "langs");
    try {
        const languageData = JSON.parse(fs.readFileSync(path.join(languageDir, `${language}.json`), "utf8"));
        const languages = languageData._trayMenu;
        if (languages && typeof languages.arm64TranslationTitle === "string" &&
            typeof languages.arm64TranslationMessage === "string" &&
            typeof languages.downloadAppleSilicon === "string") {
            return languages;
        }
    } catch (error) {
        writeLog("load Apple silicon warning languages failed: " + error);
    }
    return {
        arm64TranslationTitle: "Install the Apple silicon version",
        arm64TranslationMessage: "SiYuan is running the Intel version through Rosetta. This may significantly " +
            "reduce performance. Please use the Apple silicon version",
        downloadAppleSilicon: "Download the Apple silicon version",
    };
};

const markExpectedRendererExit = (window) => {
    if (window && !window.isDestroyed()) {
        expectedRendererExitIds.add(window.webContents.id);
    }
};

const exitWorkspace = (workspace, errorWindowId) => {
    if (!workspace) {
        return;
    }
    const workspaceIndex = workspaces.indexOf(workspace);
    const mainWindow = workspace.browserWindow;
    const tray = workspace.tray;
    const kernelOrigin = workspace.kernelTarget?.origin;

    // 关闭连接同一内核的所有非主窗口。
    BrowserWindow.getAllWindows().forEach((item) => {
        try {
            const currentURL = new URL(item.getURL());
            if (kernelOrigin && kernelOrigin === currentURL.origin) {
                if (!mainWindow || mainWindow.id !== item.id) {
                    item.destroy();
                }
            }
        } catch (e) {
            // load file is not a url
        }
    });
    if (workspaceIndex > -1) {
        if (workspaces.length > 1 && mainWindow && !mainWindow.isDestroyed()) {
            markExpectedRendererExit(mainWindow);
            mainWindow.destroy();
        }
        workspaces.splice(workspaceIndex, 1);
    }
    if (tray && ("win32" === process.platform || "linux" === process.platform)) {
        tray.destroy();
    }
    if (workspaces.length === 0 && mainWindow) {
        try {
            if (resetWindowStateOnRestart) {
                fs.writeFileSync(windowStatePath, "{}");
            } else {
                // 保存窗口状态供下次启动恢复。isMaximized 记录关闭时是否最大化；x/y/width/height 须用 getNormalBounds，
                // 其在任意窗口状态下均返回向下还原时的矩形。而 getBounds 在最大化时返回全屏尺寸，会导致还原时贴边。
                // https://github.com/siyuan-note/siyuan/issues/18154
                // https://www.electronjs.org/docs/latest/api/browser-window#wingetnormalbounds
                const bounds = mainWindow.getNormalBounds();
                fs.writeFileSync(windowStatePath, JSON.stringify({
                    isMaximized: mainWindow.isMaximized(),
                    fullscreen: mainWindow.isFullScreen(),
                    isDevToolsOpened: mainWindow.webContents.isDevToolsOpened(),
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                }));
            }
        } catch (e) {
            writeLog(e);
        }

        if (errorWindowId) {
            markExpectedRendererExit(mainWindow);
            BrowserWindow.getAllWindows().forEach((item) => {
                if (errorWindowId !== item.id) {
                    item.destroy();
                }
            });
        } else {
            markExpectedRendererExit(mainWindow);
            if (keepAppOpenDuringSystemShutdown || keepAppOpenDuringUpdate) {
                mainWindow.destroy();
            } else {
                app.exit();
            }
        }
        globalShortcut.unregisterAll();
        writeLog("exited ui");
    }
};

const exitApp = (port, errorWindowId) => {
    if (port === undefined || port === null) {
        return;
    }
    const workspace = workspaces.find((item) => item.ownsKernel && port.toString() === item.port.toString());
    exitWorkspace(workspace, errorWindowId);
};

const localServer = "https://127.0.0.1";

const getServer = (port = kernelPort) => {
    return localServer + ":" + port;
};

const getKernelTarget = (target = kernelPort) => {
    if (target && typeof target === "object" && target.origin) {
        return target;
    }
    return createLocalKernelTarget(target);
};

const rememberWindowKernelTarget = (window, target) => {
    const webContentsId = window.webContents.id;
    windowKernelTargets.set(webContentsId, target);
    if (target.mode === "remote") {
        window.webContents.on("will-frame-navigate", (event) => {
            if (shouldBlockRemoteFrameNavigation({isMainFrame: event.isMainFrame})) {
                event.preventDefault();
                writeLog("blocked subframe navigation in remote kernel mode [url=" + event.url + "]");
            }
        });
        window.webContents.on("will-attach-webview", (event) => {
            event.preventDefault();
            writeLog("blocked webview creation in remote kernel mode");
        });
    }
    window.webContents.on("did-start-navigation", (details) => {
        if (details.isMainFrame && !details.isSameDocument) {
            initializedWindowIds.delete(webContentsId);
        }
    });
    window.webContents.once("destroyed", () => {
        initializedWindowIds.delete(webContentsId);
        windowKernelTargets.delete(webContentsId);
    });
};

const getWindowKernelTarget = (webContentsId) => windowKernelTargets.get(webContentsId);

const getLocalRemoteResource = (pathname) => {
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch (error) {
        return;
    }
    if (decodedPath.includes("\0")) {
        return;
    }

    if (decodedPath === "/check-auth") {
        return isDevEnv
            ? path.join(appDir, "electron", "remote-auth.html")
            : path.join(appDir, "app", "electron", "remote-auth.html");
    }

    let resourceRoot;
    let relativePath;
    if (decodedPath.startsWith("/stage/")) {
        resourceRoot = path.join(appDir, "stage");
        relativePath = decodedPath.slice("/stage/".length);
    } else if (decodedPath.startsWith("/appearance/")) {
        resourceRoot = path.join(appDir, "appearance");
        relativePath = decodedPath.slice("/appearance/".length);
    } else {
        return;
    }

    let resourcePath = path.resolve(resourceRoot, relativePath);
    const relative = path.relative(resourceRoot, resourcePath);
    if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) {
        if (!relative && decodedPath.endsWith("/")) {
            resourcePath = path.join(resourcePath, "index.html");
        } else {
            return;
        }
    }
    try {
        if (fs.statSync(resourcePath).isDirectory()) {
            resourcePath = path.join(resourcePath, "index.html");
        }
        if (fs.statSync(resourcePath).isFile()) {
            return resourcePath;
        }
    } catch (error) {
        return;
    }
};

let remoteProtocolInstalled = false;
const installRemoteFrontendProtocol = (target) => {
    if (remoteProtocolInstalled) {
        return;
    }
    const scheme = new URL(target.origin).protocol.slice(0, -1);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const destination = getRemoteKernelWebRequestDestination(details.resourceType);
        let requestPolicy = "remote";
        if (destination) {
            try {
                const requestURL = new URL(details.url);
                const isTargetOrigin = requestURL.origin === target.origin;
                const localResource = isTargetOrigin ? getLocalRemoteResource(requestURL.pathname) : undefined;
                requestPolicy = getRemoteKernelRequestPolicy({
                    method: details.method,
                    pathname: requestURL.pathname,
                    destination,
                    localResourceAvailable: Boolean(localResource),
                    isTargetOrigin,
                });
            } catch (error) {
                requestPolicy = "deny-active-content";
            }
        }
        callback({
            cancel: shouldBlockRemoteFrameNavigation({resourceType: details.resourceType}) ||
                requestPolicy === "deny-active-content",
        });
    });
    session.defaultSession.protocol.handle(scheme, async (request) => {
        const forwardRequest = (includeCredentials = false) => session.defaultSession.fetch(request, {
            bypassCustomProtocolHandlers: true,
            redirect: "manual",
            ...(includeCredentials ? {credentials: "include"} : {}),
        });
        let requestURL;
        try {
            requestURL = new URL(request.url);
        } catch (error) {
            requestURL = undefined;
        }

        const isTargetOrigin = requestURL?.origin === target.origin;
        const requestPathname = requestURL?.pathname || "/";
        const localDocumentRequest = isTargetOrigin && (request.method === "GET" || request.method === "HEAD") &&
            ["/check-auth", "/stage/build/app/", "/stage/build/app/window.html"].includes(requestURL.pathname);
        const localResource = isTargetOrigin && (request.method === "GET" || request.method === "HEAD")
            ? getLocalRemoteResource(requestURL.pathname)
            : undefined;
        const requestDestination = request.headers.get("sec-fetch-dest") || request.destination;
        const requestPolicy = getRemoteKernelRequestPolicy({
            method: request.method,
            pathname: requestPathname,
            destination: requestDestination,
            localResourceAvailable: Boolean(localResource),
            isTargetOrigin,
        });
        if (requestPolicy === "deny-api") {
            writeLog("blocked remote kernel lifecycle request [path=" + requestPathname + "]");
            return new Response(JSON.stringify({
                code: -1,
                msg: "This operation is unavailable in remote kernel mode.",
            }), {
                status: 403,
                headers: {"Content-Type": "application/json; charset=utf-8"},
            });
        }
        if (requestPolicy === "deny-active-content") {
            return new Response("Forbidden", {
                status: 403,
                headers: {"Content-Type": "text/plain; charset=utf-8"},
            });
        }
        if (!isTargetOrigin) {
            return forwardRequest();
        }
        if (requestPolicy === "local") {
            if (localDocumentRequest) {
                let versionData;
                try {
                    versionData = await requestRemoteKernelVersion(target);
                } catch (error) {
                    writeLog("verify remote kernel version before loading local UI failed: " + error.message);
                    return new Response("Unable to verify the remote kernel version.", {
                        status: 502,
                        headers: {
                            "Cache-Control": "no-store",
                            "Content-Type": "text/plain; charset=utf-8",
                        },
                    });
                }
                const versionStatus = getRemoteKernelVersionStatus(versionData, appVer);
                if (versionStatus !== "compatible") {
                    writeLog("blocked local UI for an incompatible remote kernel [status=" + versionStatus + "]");
                    return new Response("The remote kernel version does not match this client.", {
                        status: 409,
                        headers: {
                            "Cache-Control": "no-store",
                            "Content-Type": "text/plain; charset=utf-8",
                        },
                    });
                }
            }
            if (localDocumentRequest &&
                ["/stage/build/app/", "/stage/build/app/window.html"].includes(requestURL.pathname)) {
                const authenticationResponse = await session.defaultSession.fetch(request, {
                    bypassCustomProtocolHandlers: true,
                    credentials: "include",
                    redirect: "manual",
                });
                await authenticationResponse.body?.cancel();
                if (!authenticationResponse.ok) {
                    const responseLocation = authenticationResponse.headers.get("location");
                    let authenticationRequired = authenticationResponse.status === 401;
                    if (responseLocation && authenticationResponse.status >= 300 && authenticationResponse.status < 400) {
                        try {
                            const redirectURL = new URL(responseLocation, target.origin);
                            authenticationRequired = redirectURL.origin === target.origin &&
                                redirectURL.pathname === "/check-auth";
                        } catch (error) {
                            authenticationRequired = false;
                        }
                    }
                    if (authenticationRequired) {
                        const authURL = new URL("/check-auth", target.origin);
                        authURL.searchParams.set("to", requestURL.pathname + requestURL.search);
                        authURL.searchParams.set("lang", resolveAppLanguage(app.getPreferredSystemLanguages()));
                        authURL.searchParams.set("remote", "1");
                        return new Response(null, {
                            status: 302,
                            headers: {
                                "Cache-Control": "no-store",
                                Location: authURL.href,
                            },
                        });
                    }
                    return new Response("Remote kernel UI probe failed.", {
                        status: authenticationResponse.status >= 400 ? authenticationResponse.status : 502,
                        headers: {
                            "Cache-Control": "no-store",
                            "Content-Type": "text/plain; charset=utf-8",
                        },
                    });
                }
            }
            const localResponse = await net.fetch(pathToFileURL(localResource).toString());
            if (localDocumentRequest) {
                const responseHeaders = new Headers(localResponse.headers);
                responseHeaders.set("Cache-Control", "no-store");
                responseHeaders.set("Content-Security-Policy",
                    createRemoteDocumentContentSecurityPolicy(fs.readFileSync(localResource, "utf8"), target.origin));
                return new Response(localResponse.body, {
                    status: localResponse.status,
                    statusText: localResponse.statusText,
                    headers: responseHeaders,
                });
            }
            return localResponse;
        }
        if (requestPolicy === "not-found") {
            return new Response("Not Found", {
                status: 404,
                headers: {"Content-Type": "text/plain; charset=utf-8"},
            });
        }
        const response = await forwardRequest(true);
        const redirectDecision = getRemoteKernelRedirectDecision({
            status: response.status,
            location: response.headers.get("location"),
            origin: target.origin,
            method: request.method,
        });
        if (redirectDecision.action === "none") {
            return response;
        }
        if (redirectDecision.action === "deny") {
            await response.body?.cancel();
            writeLog("blocked remote kernel redirect outside the configured origin [path=" + requestURL.pathname + "]");
            return new Response("Forbidden redirect", {
                status: 403,
                headers: {"Content-Type": "text/plain; charset=utf-8"},
            });
        }
        const redirectLocalResource = redirectDecision.method === "GET" || redirectDecision.method === "HEAD"
            ? getLocalRemoteResource(redirectDecision.url.pathname)
            : undefined;
        const redirectPolicy = getRemoteKernelRequestPolicy({
            method: redirectDecision.method,
            pathname: redirectDecision.url.pathname,
            destination: requestDestination,
            localResourceAvailable: Boolean(redirectLocalResource),
            isTargetOrigin: true,
        });
        if (redirectPolicy === "deny-api" || redirectPolicy === "deny-active-content" ||
            redirectPolicy === "not-found") {
            await response.body?.cancel();
            writeLog("blocked unsafe remote kernel redirect [path=" + redirectDecision.url.pathname +
                ", policy=" + redirectPolicy + "]");
            return new Response(redirectPolicy === "not-found" ? "Not Found" : "Forbidden redirect", {
                status: redirectPolicy === "not-found" ? 404 : 403,
                headers: {"Content-Type": "text/plain; charset=utf-8"},
            });
        }
        return response;
    });
    remoteProtocolInstalled = true;
    writeLog("installed local frontend handler for remote kernel [origin=" + target.origin + "]");
};

const requestKernelExit = (port, options = {}, signal) => {
    if (!port) {
        return Promise.resolve();
    }

    const exitOptions = Object.assign({
        force: false,
        setCurrentWorkspace: true,
        execInstallPkg: 1,
    }, options);
    return net.fetch(getServer(port) + "/api/system/exit", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(exitOptions),
        signal,
    }).catch((error) => {
        writeLog("shutdown kernel failed [port=" + port + "]: " + error);
    });
};

const waitForKernelProcessExit = (port, timeout) => {
    const portKey = port.toString();
    const kernelProcess = kernelProcesses.get(portKey);
    if (!kernelProcess) {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        let timer;
        const onClose = () => {
            clearTimeout(timer);
            resolve(true);
        };
        kernelProcess.once("close", onClose);
        timer = setTimeout(() => {
            kernelProcess.removeListener("close", onClose);
            resolve(false);
        }, timeout);
    });
};

const requestUpdateKernelExit = async (port, options) => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), updateKernelExitTimeout);
    try {
        const response = await requestKernelExit(port, options, abortController.signal);
        if (!response) {
            return false;
        }
        const apiData = await response.json();
        if (apiData.code === 0) {
            writeLog("update kernel exit request succeeded [port=" + port + "]");
            return apiData;
        }
        writeLog("update kernel exit request failed [port=" + port + ", code=" + apiData.code + "]");
    } catch (error) {
        writeLog("parse update kernel exit response failed [port=" + port + "]: " + error);
    } finally {
        clearTimeout(timeout);
    }
    return false;
};

const closeKernelForUpdate = async (port, initiatingPort, setCurrentWorkspace) => {
    const isInitiatingKernel = port.toString() === initiatingPort.toString();
    const exitResponse = await requestUpdateKernelExit(port, {
        force: isInitiatingKernel,
        setCurrentWorkspace: isInitiatingKernel && setCurrentWorkspace,
        execInstallPkg: isInitiatingKernel ? 2 : 1,
    });
    if (exitResponse) {
        return exitResponse;
    }

    writeLog("forcing kernel to exit for update [port=" + port + "]");
    return requestUpdateKernelExit(port, {
        force: true,
        setCurrentWorkspace: isInitiatingKernel && setCurrentWorkspace,
        execInstallPkg: isInitiatingKernel ? 2 : 1,
    });
};

const validateUpdateInstallRequest = (event, data) => {
    const workspace = workspaces.find((item) => item.webContentsId === event.sender.id);
    if (!workspace || !workspace.ownsKernel || !workspace.workspaceDir || !data || !data.port ||
        workspace.port.toString() !== data.port.toString()) {
        writeLog("rejected update install request from an unknown workspace");
        return;
    }
    if (process.platform !== "win32" && process.platform !== "darwin") {
        writeLog("rejected update install request on unsupported platform [platform=" + process.platform + "]");
        return;
    }

    return {
        initiatingPort: workspace.port.toString(),
        setCurrentWorkspace: data.setCurrentWorkspace !== false,
        workspaceDir: workspace.workspaceDir,
    };
};

const validateUpdateInstallPackage = (request, requestedInstallPkgPath) => {
    if (!requestedInstallPkgPath) {
        writeLog("the initiating kernel did not return an update install package");
        return;
    }

    try {
        const installDir = fs.realpathSync(path.join(request.workspaceDir, "temp", "install"));
        const installPkgPath = fs.realpathSync(requestedInstallPkgPath);
        const relativePkgPath = path.relative(installDir, installPkgPath);
        if (!relativePkgPath || path.isAbsolute(relativePkgPath) || path.dirname(relativePkgPath) !== ".") {
            writeLog("rejected update install package outside the workspace install directory [path=" + installPkgPath + "]");
            return;
        }

        const packageName = path.basename(installPkgPath);
        const validPackageName = process.platform === "win32"
            ? /^siyuan-.+-win(?:-arm64)?\.exe$/i.test(packageName)
            : /^siyuan-.+-mac(?:-arm64)?\.dmg$/i.test(packageName);
        if (!validPackageName || !fs.statSync(installPkgPath).isFile()) {
            writeLog("rejected invalid update install package [path=" + installPkgPath + "]");
            return;
        }
        writeLog("validated update install package [path=" + installPkgPath + "]");
        return installPkgPath;
    } catch (error) {
        writeLog("validate update install package failed: " + error);
    }
};

const launchUpdateInstallPackage = (installPkgPath) => {
    return new Promise((resolve, reject) => {
        const command = process.platform === "darwin" ? "/usr/bin/open" : installPkgPath;
        const args = process.platform === "darwin" ? [installPkgPath] : [];
        const installProcess = childProcess.spawn(command, args, {
            cwd: path.dirname(installPkgPath),
            detached: true,
            stdio: "ignore",
        });
        installProcess.once("error", reject);
        installProcess.once("spawn", () => {
            writeLog("launched update install package [pid=" + installProcess.pid + ", path=" + installPkgPath + "]");
            installProcess.unref();
            resolve();
        });
    });
};

const waitForUpdateKernelExits = async (ports) => {
    if (ports.length === 0) {
        return;
    }

    const exitResults = await Promise.all(ports.map(async (port) => {
        return {
            port,
            exited: await waitForKernelProcessExit(port, updateKernelExitTimeout),
        };
    }));
    const timedOutPorts = exitResults.filter((item) => !item.exited).map((item) => item.port);
    if (timedOutPorts.length === 0) {
        return;
    }

    writeLog("kernel exit timed out before update [ports=" + timedOutPorts.join(",") + "]");
    timedOutPorts.forEach((port) => {
        const kernelProcess = kernelProcesses.get(port);
        if (kernelProcess) {
            writeLog("terminating residual kernel before update [pid=" + kernelProcess.pid + ", port=" + port + "]");
            kernelProcess.kill("SIGKILL");
        }
    });
    await Promise.all(timedOutPorts.map((port) => waitForKernelProcessExit(port, 5000)));
    const residualPorts = timedOutPorts.filter((port) => kernelProcesses.has(port));
    if (residualPorts.length > 0) {
        if (process.platform === "win32") {
            writeLog("residual kernel processes will be terminated by the installer [ports=" + residualPorts.join(",") + "]");
        } else {
            throw new Error("failed to terminate residual kernel processes [ports=" + residualPorts.join(",") + "]");
        }
    }
};

const closeUpdateKernelStage = async (ports, request) => {
    if (ports.length === 0) {
        return [];
    }

    const exitResponses = await Promise.all(ports.map((port) => closeKernelForUpdate(port, request.initiatingPort,
        request.setCurrentWorkspace)));
    ports.forEach((port) => exitApp(port));
    await waitForUpdateKernelExits(ports);
    return exitResponses;
};

// 更新时先退出其他工作空间，再退出发起更新的工作空间，确保安装器启动前所有内核已经停止。
// https://github.com/siyuan-note/siyuan/issues/18258
const coordinateUpdateInstall = async (request) => {
    const ports = Array.from(new Set(getSystemShutdownPorts().map((port) => port.toString())
        .concat(Array.from(kernelProcesses.keys()), request.initiatingPort)));
    ports.forEach((port) => expectedKernelExitPorts.add(port));
    writeLog("coordinating update install [initiatingPort=" + request.initiatingPort + ", ports=" + ports.join(",") +
        "]");

    workspaces.forEach((workspace) => {
        if (workspace.browserWindow && !workspace.browserWindow.isDestroyed()) {
            workspace.browserWindow.hide();
        }
    });

    const otherPorts = ports.filter((port) => port !== request.initiatingPort);
    writeLog("closing other workspaces for update [ports=" + otherPorts.join(",") + "]");
    await closeUpdateKernelStage(otherPorts, request);
    writeLog("closing initiating workspace for update [port=" + request.initiatingPort + "]");
    const [initiatingExitResponse] = await closeUpdateKernelStage([request.initiatingPort], request);
    const installPkgPath = validateUpdateInstallPackage(request, initiatingExitResponse?.data?.installPkgPath);
    if (!installPkgPath) {
        throw new Error("the update install package returned by the kernel is invalid");
    }

    await launchUpdateInstallPackage(installPkgPath);
    keepAppOpenDuringUpdate = false;
    app.exit();
};

const beginUpdateInstall = (event, data) => {
    if (updateInstallPromise) {
        writeLog("ignored duplicate update install request");
        return true;
    }
    if (systemShutdownState !== systemShutdownNone) {
        writeLog("rejected update install request during system shutdown");
        return false;
    }

    const request = validateUpdateInstallRequest(event, data);
    if (!request) {
        return false;
    }

    keepAppOpenDuringUpdate = true;
    updateInstallPromise = coordinateUpdateInstall(request).catch((error) => {
        writeLog("coordinate update install failed: " + error);
        keepAppOpenDuringUpdate = false;
        updateInstallPromise = undefined;
        app.relaunch();
        app.exit();
    });
    return true;
};

const getSystemShutdownPorts = () => {
    const ports = new Set();
    workspaces.forEach((workspaceItem) => {
        if (workspaceItem.ownsKernel && workspaceItem.port) {
            ports.add(workspaceItem.port);
        }
    });
    if (!remoteKernelTarget && bootWindow && !bootWindow.isDestroyed() && kernelPort) {
        ports.add(kernelPort);
    }
    return Array.from(ports);
};

const requestGracefulKernelExit = async (port) => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), systemShutdownExitTimeout);
    try {
        const response = await requestKernelExit(port, {
            force: false,
            setCurrentWorkspace: false,
            execInstallPkg: 1,
        }, abortController.signal);
        if (!response) {
            return false;
        }

        const apiData = await response.json();
        if (apiData.code !== 0) {
            writeLog("graceful system shutdown failed [port=" + port + ", code=" + apiData.code + "]");
            return false;
        }
        writeLog("graceful system shutdown succeeded [port=" + port + "]");
        return true;
    } catch (error) {
        writeLog("parse graceful system shutdown response failed [port=" + port + "]: " + error);
        return false;
    } finally {
        clearTimeout(timeout);
    }
};

const resetSystemShutdown = (ports) => {
    if (systemShutdownState === systemShutdownForced) {
        return;
    }

    systemShutdownState = systemShutdownNone;
    gracefulSystemShutdownPromise = undefined;
    keepAppOpenDuringSystemShutdown = false;
    writeLog("system shutdown canceled because SiYuan failed to exit gracefully [ports=" + ports.join(",") + "]");
    ports.forEach((port) => {
        const workspace = workspaces.find((item) => port.toString() === item.port.toString());
        if (workspace && workspace.browserWindow && !workspace.browserWindow.isDestroyed()) {
            showWindow(workspace.browserWindow);
        }
    });
    if (bootWindow && !bootWindow.isDestroyed() && ports.includes(kernelPort)) {
        showWindow(bootWindow);
    }
};

const beginGracefulSystemShutdown = () => {
    if (gracefulSystemShutdownPromise || systemShutdownState === systemShutdownForced) {
        return;
    }

    systemShutdownState = systemShutdownEnding;
    const ports = getSystemShutdownPorts();
    if (ports.length === 0) {
        app.exit();
        return;
    }

    keepAppOpenDuringSystemShutdown = true;
    gracefulSystemShutdownPromise = Promise.all(ports.map(async (port) => {
        return {
            port,
            success: await requestGracefulKernelExit(port),
        };
    })).then((results) => {
        const succeededPorts = results.filter((item) => item.success).map((item) => item.port);
        const failedPorts = results.filter((item) => !item.success).map((item) => item.port);
        succeededPorts.forEach((port) => exitApp(port));
        if (bootWindow && !bootWindow.isDestroyed() && succeededPorts.includes(kernelPort)) {
            bootWindow.destroy();
        }

        const remainingPorts = getSystemShutdownPorts();
        const incompletePorts = Array.from(new Set(failedPorts.concat(remainingPorts)));
        if (incompletePorts.length > 0) {
            resetSystemShutdown(incompletePorts);
            return;
        }
        keepAppOpenDuringSystemShutdown = false;
        app.exit();
    }).catch((error) => {
        writeLog("graceful system shutdown failed: " + error);
        resetSystemShutdown(getSystemShutdownPorts());
    });
};

const beginForcedSystemShutdown = () => {
    if (systemShutdownState === systemShutdownForced) {
        return;
    }

    systemShutdownState = systemShutdownForced;
    keepAppOpenDuringSystemShutdown = false;
    getSystemShutdownPorts().forEach((port) => {
        requestKernelExit(port, {
            force: true,
            setCurrentWorkspace: false,
        });
    });
};

if (process.platform === "win32") {
    // Windows 关机、重启或注销时取消本次会话结束，等待内核安全退出后再关闭思源。
    app.on("browser-window-created", (event, window) => {
        window.on("query-session-end", (sessionEvent) => {
            writeLog("query-session-end");
            sessionEvent.preventDefault();
            beginGracefulSystemShutdown();
        });
        window.on("session-end", () => {
            writeLog("session-end");
            beginForcedSystemShutdown();
        });
    });
}

const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

const showErrorWindow = (titleZh, titleEn, content, emoji = "⚠️", logPath = "") => {
    let errorHTMLPath = path.join(appDir, "app", "electron", "error.html");
    if (isDevEnv) {
        errorHTMLPath = path.join(appDir, "electron", "error.html");
    }
    const errWindow = new BrowserWindow({
        width: Math.floor(screen.getPrimaryDisplay().size.width * 0.5),
        height: Math.floor(screen.getPrimaryDisplay().workAreaSize.height * 0.8),
        frame: "darwin" === process.platform,
        titleBarStyle: "hidden",
        fullscreenable: false,
        icon: path.join(appDir, "stage", "icon-large.png"),
        transparent: "darwin" === process.platform, // 避免深色模式关闭窗口时闪现白色背景
        webPreferences: {
            nodeIntegration: true, webviewTag: true, webSecurity: false, contextIsolation: false,
        },
    });
    errWindow.loadFile(errorHTMLPath, {
        query: {
            home: app.getPath("home"),
            v: appVer,
            title: `<h2>${titleZh}</h2><h2>${titleEn}</h2>`,
            emoji,
            content,
            logPath,
            icon: path.join(appDir, "stage", "icon-large.png"),
        },
    });
    errWindow.show();
    return errWindow.id;
};

const initMainWindow = (kernel = kernelPort, remoteAuthenticated = true) => {
    if (!app.isReady()) {
        writeLog("initMainWindow: app not ready, skipping");
        return;
    }
    const kernelTarget = getKernelTarget(kernel);
    const currentKernelPort = kernelTarget.port;

    // 恢复主窗体状态
    let oldWindowState = {};
    try {
        oldWindowState = JSON.parse(fs.readFileSync(windowStatePath, "utf8"));
    } catch (e) {
        writeLog("read window state failed: " + e);
        fs.writeFileSync(windowStatePath, "{}");
    }
    let defaultWidth;
    let defaultHeight;
    let workArea;
    try {
        defaultWidth = Math.floor(screen.getPrimaryDisplay().size.width * 0.8);
        defaultHeight = Math.floor(screen.getPrimaryDisplay().workAreaSize.height * 0.8);
        workArea = screen.getPrimaryDisplay().workArea;
    } catch (e) {
        writeLog("get screen size failed: " + e);
    }
    const windowState = Object.assign({}, {
        isMaximized: false,
        fullscreen: false,
        isDevToolsOpened: false,
        x: 0,
        y: 0,
        width: defaultWidth,
        height: defaultHeight,
    }, oldWindowState);

    writeLog("window stat [x=" + windowState.x + ", y=" + windowState.y + ", width=" + windowState.width + ", height=" + windowState.height + "], " +
        "default [x=0, y=0, width=" + defaultWidth + ", height=" + defaultHeight + "], " +
        "old [x=" + oldWindowState.x + ", y=" + oldWindowState.y + ", width=" + oldWindowState.width + ", height=" + oldWindowState.height + "]");

    let resetToCenter = false;
    let x = windowState.x;
    if (-32 < x && 0 > x) {
        x = 0;
    }
    let y = windowState.y;
    if (-32 < y && 0 > y) {
        y = 0;
    }
    if (workArea) {
        // 窗口大于 workArea 时缩小会隐藏到左下角，这里使用最小值重置
        if (windowState.width > workArea.width + 32 || windowState.height > workArea.height + 32) {
            // 重启后窗口大小恢复默认问题 https://github.com/siyuan-note/siyuan/issues/7755 https://github.com/siyuan-note/siyuan/issues/13732
            // 这里 +32 是因为在某种情况下窗口大小会比 workArea 大几个像素导致恢复默认，+32 可以避免这种特殊情况
            windowState.width = Math.min(defaultWidth, workArea.width);
            windowState.height = Math.min(defaultHeight, workArea.height);
            writeLog("reset window size [width=" + windowState.width + ", height=" + windowState.height + "]");
        }

        if (x >= workArea.width * 0.8 || y >= workArea.height * 0.8) {
            resetToCenter = true;
            writeLog("reset window to center cause x or y >= 80% of workArea");
        }
    }

    if (x < 0 || y < 0) {
        resetToCenter = true;
        writeLog("reset window to center cause x or y < 0");
    }

    if (windowState.width < 493) {
        windowState.width = 493;
        writeLog("reset window width [493]");
    }
    if (windowState.height < 376) {
        windowState.height = 376;
        writeLog("reset window height [376]");
    }

    // 创建主窗体
    const currentWindow = new BrowserWindow({
        title: "SiYuan",
        show: false,
        width: windowState.width,
        height: windowState.height,
        minWidth: 493,
        minHeight: 376,
        fullscreenable: true,
        fullscreen: windowState.fullscreen,
        trafficLightPosition: {x: 8, y: 8},
        webPreferences: {
            nodeIntegration: true,
            nodeIntegrationInSubFrames: false,
            nodeIntegrationInWorker: false,
            webviewTag: kernelTarget.mode !== "remote",
            webSecurity: kernelTarget.mode === "remote",
            contextIsolation: false,
            autoplayPolicy: "user-gesture-required" // 桌面端禁止自动播放多媒体 https://github.com/siyuan-note/siyuan/issues/7587
        },
        frame: "darwin" === process.platform,
        titleBarStyle: "hidden",
        icon: path.join(appDir, "stage", "icon-large.png"),
    });
    remote.enable(currentWindow.webContents);
    bindSpellcheckContextMenu(currentWindow.webContents);
    rememberWindowKernelTarget(currentWindow, kernelTarget);

    if (resetToCenter) {
        currentWindow.center();
    } else {
        writeLog("window position [x=" + x + ", y=" + y + "]");
        currentWindow.setPosition(x, y);
    }
    currentWindow.webContents.userAgent = "SiYuan/" + appVer + " https://b3log.org/siyuan Electron " + currentWindow.webContents.userAgent;

    // 加载主界面。setProxy 用超时兜底包装：Electron 在某些系统代理配置下 session.setProxy 可能永久
    // pending（既不 resolve 也不 reject），会导致 loadURL 永不执行，主窗口卡在启动页无法显示。
    // 这里无论 setProxy 是否完成，最多等待 5 秒后强制加载主界面。
    const loadMainURL = () => {
        const appURL = new URL("/stage/build/app/", kernelTarget.origin);
        appURL.searchParams.set("v", Date.now().toString());
        if (kernelTarget.mode === "remote") {
            appURL.searchParams.set("remote", "1");
        }
        if (kernelTarget.mode === "remote" && !remoteAuthenticated) {
            const authURL = new URL("/check-auth", kernelTarget.origin);
            authURL.searchParams.set("to", appURL.pathname + appURL.search);
            authURL.searchParams.set("lang", resolveAppLanguage(app.getPreferredSystemLanguages()));
            authURL.searchParams.set("remote", "1");
            currentWindow.loadURL(authURL.href);
        } else {
            currentWindow.loadURL(appURL.href);
        }
    };
    if (kernelTarget.mode === "remote") {
        loadMainURL();
    } else {
        net.fetch(getServer(currentKernelPort) + "/api/system/getNetwork", {method: "POST"}).then((response) => {
            return response.json();
        }).then((response) => {
            const proxyMode = response.data.proxy.scheme === "system" ? "system" : response.data.proxy.scheme === "" ? "direct" : "fixed_servers";
            const setProxyDone = setProxy(`${response.data.proxy.scheme}://${response.data.proxy.host}:${response.data.proxy.port}`,
                currentWindow.webContents, proxyMode);
            Promise.race([
                Promise.resolve(setProxyDone),
                new Promise((resolve) => setTimeout(resolve, 5000)), // setProxy 永久 pending 时的超时兜底
            ]).then(loadMainURL).catch(() => {
                writeLog("setProxy failed, load main UI without proxy");
                loadMainURL();
            });
        }).catch((e) => {
            // getNetwork 失败也要继续加载主界面，避免主窗口不加载导致卡在启动页
            writeLog("getNetwork failed, load main UI without proxy: " + e.message);
            loadMainURL();
        });
    }

    // 发起互联网服务请求时绕过安全策略 https://github.com/siyuan-note/siyuan/issues/5516
    currentWindow.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
        if (-1 < details.url.toLowerCase().indexOf("bili")) {
            // B 站不移除 Referer https://github.com/siyuan-note/siyuan/issues/94
            cb({requestHeaders: details.requestHeaders});
            return;
        }

        if (-1 < details.url.toLowerCase().indexOf("douyin")) {
            // 抖音不移除 Referer，iframe 块内登录依赖 Referer 校验 https://github.com/siyuan-note/siyuan/issues/18070
            cb({requestHeaders: details.requestHeaders});
            return;
        }

        if (-1 < details.url.toLowerCase().indexOf("youtube")) {
            // YouTube 设置 Referer https://github.com/siyuan-note/siyuan/issues/16319
            details.requestHeaders["Referer"] = "https://b3log.org/siyuan/";
            cb({requestHeaders: details.requestHeaders});
            return;
        }

        for (let key in details.requestHeaders) {
            if ("referer" === key.toLowerCase()) {
                delete details.requestHeaders[key];
            }
        }
        cb({requestHeaders: details.requestHeaders});
    });
    currentWindow.webContents.session.webRequest.onHeadersReceived((details, cb) => {
        let preserveRemoteDocumentCSP = false;
        if (kernelTarget.mode === "remote") {
            try {
                const responseURL = new URL(details.url);
                preserveRemoteDocumentCSP = responseURL.origin === kernelTarget.origin &&
                    ["/check-auth", "/stage/build/app/", "/stage/build/app/window.html"].includes(responseURL.pathname);
            } catch (error) {
                preserveRemoteDocumentCSP = false;
            }
        }
        for (let key in details.responseHeaders) {
            if ("x-frame-options" === key.toLowerCase()) {
                delete details.responseHeaders[key];
            } else if ("content-security-policy" === key.toLowerCase()) {
                if (!preserveRemoteDocumentCSP) {
                    delete details.responseHeaders[key];
                }
            } else if ("access-control-allow-origin" === key.toLowerCase()) {
                delete details.responseHeaders[key];
            }
        }
        cb({responseHeaders: details.responseHeaders});
    });

    currentWindow.webContents.on("did-finish-load", () => {
        if (kernelTarget.mode === "remote") {
            if (getWindowPathname(currentWindow) === "/check-auth") {
                currentWindow.show();
                if (bootWindow && !bootWindow.isDestroyed()) {
                    bootWindow.destroy();
                }
            }
            return;
        }
        let siyuanOpenURL = process.argv.find((arg) => arg.startsWith("siyuan://"));
        if (siyuanOpenURL) {
            if (currentWindow.isMinimized()) {
                currentWindow.restore();
            }
            currentWindow.show();
            setTimeout(() => { // 等待界面js执行完毕
                writeLog(siyuanOpenURL);
                currentWindow.webContents.send("siyuan-open-url", siyuanOpenURL);
            }, 2000);
        }
    });

    if ("darwin" !== process.platform) {
        setNonDarwinApplicationMenu();
    }
    // 当前页面链接使用浏览器打开
    windowNavigate(currentWindow, "app", kernelTarget.origin, kernelTarget.mode === "remote");
    currentWindow.on("close", (event) => {
        if (kernelTarget.mode === "remote" && (getWindowPathname(currentWindow) !== "/stage/build/app/" ||
            !initializedWindowIds.has(currentWindow.webContents.id))) {
            event.preventDefault();
            exitWorkspace(workspaces.find((item) => item.webContentsId === currentWindow.webContents.id));
            return;
        }
        if (currentWindow && !currentWindow.isDestroyed()) {
            currentWindow.webContents.send("siyuan-save-close", false);
        }
        event.preventDefault();
    });
    workspaces.push({
        browserWindow: currentWindow,
        webContentsId: currentWindow.webContents.id,
        port: currentKernelPort,
        ownsKernel: kernelTarget.ownsKernel,
        kernelTarget,
    });
    // loadURL 后设置超时兜底：前端 app bundle 加载或初始化异常导致 siyuan-ready-to-show 迟迟不发时，
    // 强制销毁 boot 窗口并显示主窗口，避免永久卡在启动页
    const readyToShowTimeout = setTimeout(() => {
        if (bootWindow && !bootWindow.isDestroyed()) {
            if (!currentWindow.isDestroyed()) {
                writeLog("siyuan-ready-to-show timeout, force showing main window");
                currentWindow.show();
            }
            bootWindow.destroy();
        }
    }, 60000);
    ipcMain.once("siyuan-ready-to-show", () => {
        clearTimeout(readyToShowTimeout); // 正常收到信号则取消超时兜底
        if (isOpenAsHidden()) {
            currentWindow.minimize();
        } else {
            currentWindow.show();
            if (windowState.isMaximized) {
                currentWindow.maximize();
            } else {
                currentWindow.unmaximize();
            }
            if (windowState.isDevToolsOpened) {
                currentWindow.webContents.openDevTools(); // 保证开发者工具窗口在前
            }
        }
        if (bootWindow && !bootWindow.isDestroyed()) {
            bootWindow.destroy();
        }
    });
};

const showWindow = (wnd) => {
    if (!wnd || wnd.isDestroyed()) {
        return;
    }

    if (wnd.isMinimized()) {
        wnd.restore();
    }
    wnd.show();
};

const hideWindow = (wnd) => {
    // 通过 `Alt+M` 最小化后焦点回到先前的窗口 https://github.com/siyuan-note/siyuan/issues/7275
    wnd.minimize();
    // Mac 隐藏后无法再 Dock 中显示
    if ("win32" === process.platform || "linux" === process.platform) {
        wnd.hide();
    }
};

const toggleMainWindow = (mainWindow) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
        mainWindow.show(); // 按 `Alt+M` 后隐藏窗口，再次按 `Alt+M` 显示窗口后会卡住不能编辑 https://github.com/siyuan-note/siyuan/issues/8456
    } else if (mainWindow.isVisible()) {
        if (!mainWindow.isFocused()) {
            mainWindow.show();
        } else {
            hideWindow(mainWindow);
        }
    } else {
        mainWindow.show();
    }
};

const showAppleSiliconWarning = async (lang) => {
    if (!shouldShowAppleSiliconWarning({
        isDevelopment: isDevEnv,
        isPackaged: app.isPackaged,
        platform: process.platform,
        runningUnderARM64Translation: app.runningUnderARM64Translation,
        simulateRosetta,
    })) {
        return true;
    }
    if (appleSiliconWarningShown) {
        return false;
    }

    appleSiliconWarningShown = true;
    const languages = loadAppleSiliconWarningLanguages(lang);
    try {
        const {response} = await dialog.showMessageBox({
            type: "warning",
            title: languages.arm64TranslationTitle,
            message: languages.arm64TranslationTitle,
            detail: languages.arm64TranslationMessage,
            buttons: [languages.downloadAppleSilicon],
            defaultId: 0,
            // 使用按钮数组之外的取消 ID，以区分关闭弹窗和点击下载。
            cancelId: 1,
            noLink: true,
        });
        if (shouldDownloadAppleSilicon(response)) {
            await shell.openExternal(getAppleSiliconDownloadURL(appVer));
        }
    } catch (error) {
        writeLog("show Apple silicon warning or open package download failed: " + error);
    }
    return false;
};

const loadBootWindow = (disableAppearance = false) => {
    if (!bootWindow || bootWindow.isDestroyed() || !bootIndexPath) {
        return;
    }
    if (disableAppearance) {
        bootAppearanceFallback = true;
    }
    const query = {v: appVer, port: kernelPort};
    if (remoteKernelTarget) {
        query.remote = remoteKernelTarget.origin;
        query.appearance = "0";
    }
    if (bootAppearanceFallback) {
        query.appearance = "0";
    }
    bootWindow.loadFile(bootIndexPath, {query}).catch((error) => {
        writeLog("load boot window failed: " + error);
    });
};

const createBootWindow = () => {
    bootWindow = new BrowserWindow({
        show: false,
        width: Math.floor(screen.getPrimaryDisplay().size.width / 2),
        height: Math.floor(screen.getPrimaryDisplay().workAreaSize.height / 2),
        frame: false,
        backgroundColor: "#1e1e1e",
        resizable: false,
        icon: path.join(appDir, "stage", "icon-large.png"),
        webPreferences: {
            webSecurity: false,
        },
    });
    bootAppearanceFallback = false;
    bootIndexPath = path.join(appDir, "app", "electron", "boot.html");
    if (isDevEnv) {
        bootIndexPath = path.join(appDir, "electron", "boot.html");
    }
    bootWindow.on("unresponsive", () => {
        if (!bootAppearanceFallback) {
            writeLog("boot window is unresponsive, reload without custom appearance");
            loadBootWindow(true);
        }
    });
};

const initKernel = (workspace, port, lang, safeMode) => {
    return new Promise(async (resolve) => {
        const currentWorkspace = [workspace, process.env.SIYUAN_WORKSPACE_PATH, lastWorkspacePath]
            .find(item => typeof item === "string" && item);
        const workspaceLogPath = currentWorkspace ? path.resolve(currentWorkspace, "temp", "siyuan.log") : "";
        const kernelLogPath = path.join(confDir, "kernel.log");
        // 必须在首次异步等待前创建窗口，避免工作空间选择窗口关闭后因无窗口触发应用退出。
        createBootWindow();
        if (!await showAppleSiliconWarning(lang)) {
            bootWindow.destroy();
            app.quit();
            resolve(false);
            return;
        }
        const kernelName = "win32" === process.platform ? "SiYuan-Kernel.exe" : "SiYuan-Kernel";
        const kernelPath = path.join(appDir, "kernel", kernelName);
        if (!fs.existsSync(kernelPath)) {
            showErrorWindow("内核程序丢失", "Kernel program is missing", `<div>内核程序丢失，请重新安装思源，并将思源内核程序加入杀毒软件信任列表。</div><div>The kernel program is not found, please reinstall SiYuan and add SiYuan Kernel prgram into the trust list of your antivirus software.</div><div><i>${kernelPath}</i></div>`);
            bootWindow.destroy();
            resolve(false);
            return;
        }

        if (!isDevEnv || workspaces.length > 0) {
            if (port && "" !== port) {
                kernelPort = port;
            } else {
                const getAvailablePort = () => {
                    // https://gist.github.com/mikeal/1840641
                    return new Promise((portResolve, portReject) => {
                        const server = gNet.createServer();
                        server.on("error", error => {
                            writeLog(error);
                            kernelPort = "";
                            portReject();
                        });
                        server.listen(0, () => {
                            kernelPort = server.address().port;
                            server.close(() => portResolve(kernelPort));
                        });
                    });
                };
                await getAvailablePort();
            }
        }
        writeLog("got kernel port [" + kernelPort + "]");
        if (!kernelPort) {
            bootWindow.destroy();
            resolve(false);
            return;
        }
        if (!openAsHidden) {
            const currentBootWindow = bootWindow;
            if ("win32" === process.platform) {
                currentBootWindow.setOpacity(0);
            }
            currentBootWindow.once("ready-to-show", () => {
                if (bootWindow === currentBootWindow && !currentBootWindow.isDestroyed()) {
                    currentBootWindow.show();
                    if ("win32" === process.platform) {
                        setImmediate(() => {
                            if (bootWindow === currentBootWindow && !currentBootWindow.isDestroyed()) {
                                currentBootWindow.setOpacity(1);
                            }
                        });
                    }
                }
            });
        }
        loadBootWindow();
        if (openAsHidden) {
            bootWindow.minimize();
        }
        const currentKernelPort = kernelPort;
        const cmds = ["serve", "--port", currentKernelPort, "--wd", appDir, "--attach-ui"];
        if (isDevEnv && workspaces.length === 0) {
            cmds.push("--mode", "dev");
        }
        if (workspace && "" !== workspace) {
            cmds.push("--workspace", workspace);
        }
        if (lang && "" !== lang) {
            cmds.push("--lang", lang);
        }
        if (safeMode) {
            cmds.push("--safe-mode", "true");
        }
        let cmd = `ui version [${appVer}], booting kernel [${kernelPath} ${cmds.join(" ")}]`;
        writeLog(cmd);
        if (!isDevEnv || workspaces.length > 0) {
            const kernelProcess = childProcess.spawn(kernelPath, cmds, {
                detached: false, // 桌面端内核进程不再以游离模式拉起 https://github.com/siyuan-note/siyuan/issues/6336
                stdio: "ignore",
            },);

            const kernelPortKey = currentKernelPort.toString();
            kernelProcesses.set(kernelPortKey, kernelProcess);
            writeLog("booted kernel process [pid=" + kernelProcess.pid + ", port=" + currentKernelPort + "]");
            kernelProcess.on("close", (code, signal) => {
                if (kernelProcesses.get(kernelPortKey) === kernelProcess) {
                    kernelProcesses.delete(kernelPortKey);
                }
                const expectedExit = expectedKernelExitPorts.delete(kernelPortKey);
                writeLog(`kernel [pid=${kernelProcess.pid}, port=${currentKernelPort}] exited with code [${code}], signal [${signal}], expected [${expectedExit}]`);
                if (0 !== code && !expectedExit) {
                    let errorWindowId;
                    switch (code) {
                        case 20:
                            errorWindowId = showErrorWindow("数据库不可用", "The database is unavailable", "<div>无法访问数据库文件，请查看 <a href=\"#\" data-log-path>工作空间/temp/siyuan.log</a> 获取详细报错信息</div><div>Cannot access the database file. Please check <a href=\"#\" data-log-path>workspace/temp/siyuan.log</a> for detailed error information.</div>", "⚠️", workspaceLogPath);
                            break;
                        case 21:
                            errorWindowId = showErrorWindow("监听端口 " + currentKernelPort + " 失败", "Failed to listen to port " + currentKernelPort, "<div>监听 " + currentKernelPort + " 端口失败，请确保程序拥有网络权限并不受防火墙和杀毒软件阻止。</div><div>Failed to listen to port " + currentKernelPort + ", please make sure the program has network permissions and is not blocked by firewalls and antivirus software.</div>");
                            break;
                        case 24: // 工作空间已被锁定，尝试切换到第一个打开的工作空间
                            if (workspaces && 0 < workspaces.length) {
                                showWindow(workspaces[0].browserWindow);
                            }

                            errorWindowId = showErrorWindow("工作空间已被锁定", "The workspace is locked", "<div>该工作空间正在被使用，请尝试在任务管理器中结束 SiYuan-Kernel 进程或者重启操作系统后再启动思源。</div><div>The workspace is being used, please try to end the SiYuan-Kernel process in the task manager or restart the operating system and then start SiYuan.</div>");
                            break;
                        case 25:
                            errorWindowId = showErrorWindow("初始化工作空间失败", "Failed to create workspace directory", "<div>工作空间文件夹权限不足，请查看 <a href=\"#\" data-log-path>~/.config/siyuan/kernel.log</a> 获取详细报错信息</div><div>Insufficient permissions for the workspace folder. Please check <a href=\"#\" data-log-path>~/.config/siyuan/kernel.log</a> for detailed error information.</div>", "⚠️", kernelLogPath);
                            break;
                        case 26:
                            errorWindowId = showErrorWindow("文件系统访问失败", "File system access failed", "<div>思源内核无法访问所需文件，现已安全退出。可能原因包括文件或文件夹权限不足、文件为只读、文件被其他程序占用，以及同步盘或安全软件干预。</div><div>请查看 <a href=\"#\" data-log-path>工作空间/temp/siyuan.log</a> 获取详细错误信息。</div><div>SiYuan Kernel could not access a required file and has exited safely. Possible causes include insufficient permissions, read-only files, another process using a file, or interference from sync or security software.</div><div>Please check <a href=\"#\" data-log-path>workspace/temp/siyuan.log</a> for details.</div>", "⚠️", workspaceLogPath);
                            break;
                        case 0:
                            break;
                        default:
                            errorWindowId = showErrorWindow("内核因未知原因退出", "The kernel exited for unknown reasons", `<div>思源内核因未知原因退出 [code=${code}]，请尝试重启操作系统后再启动思源。如果该问题依然发生，请检查杀毒软件是否阻止思源内核启动。</div><div>SiYuan Kernel exited for unknown reasons [code=${code}], please try to reboot your operating system and then start SiYuan again. If occurs this problem still, please check your anti-virus software whether kill the SiYuan Kernel.</div>`);
                            break;
                    }

                    exitApp(currentKernelPort, errorWindowId);
                    bootWindow.destroy();
                    resolve(false);
                }
            });
        }

        let apiData;
        let count = 0;
        writeLog("checking kernel version");
        for (; ;) {
            try {
                const apiResult = await net.fetch(getServer(currentKernelPort) + "/api/system/version");
                apiData = await apiResult.json();
                break;
            } catch (e) {
                writeLog("get kernel version failed: " + e.message);
                if (14 < ++count) {
                    writeLog("get kernel ver failed");
                    showErrorWindow("获取内核服务端口失败", "Failed to Obtain Kernel Service Port", "<div>获取内核服务端口失败，请确保程序拥有网络权限并不受防火墙和杀毒软件阻止。</div><div>Failed to obtain kernel service port. Please ensure SiYuan has network permissions and is not blocked by firewalls or antivirus software.</div>");
                    bootWindow.destroy();
                    resolve(false);
                    return;
                }
                await sleep(500);
            }
        }

        if (0 === apiData.code) {
            writeLog("got kernel version [" + apiData.data + "]");
            if (!isDevEnv && apiData.data !== appVer) {
                writeLog(`kernel [${apiData.data}] is running, shutdown it now and then start kernel [${appVer}]`);
                requestKernelExit(currentKernelPort);
                bootWindow.destroy();
                resolve(false);
            } else {
                let progressing = false;
                const bootShowStart = Date.now();
                // 启动超时兜底，防止内核异常时永久卡在 boot 轮询。数据同步、首次全量索引重建、
                // 数据库版本变更触发的全表重建都发生在 SetBooted() 之前，会计入此循环，故给足余量
                const bootTimeout = 300000;
                while (!progressing) {
                    if (Date.now() - bootShowStart > bootTimeout) {
                        writeLog("boot progress timeout after " + bootTimeout + "ms, exiting boot");
                        showErrorWindow("启动超时", "Boot timeout",
                            "<div>内核启动超时，请查看 <a href=\"#\" data-log-path>工作空间/temp/siyuan.log</a> 获取详细报错信息，或尝试重启思源。</div>" +
                            "<div>Kernel boot timed out. Please check <a href=\"#\" data-log-path>workspace/temp/siyuan.log</a> for details, or try restarting SiYuan.</div>",
                            "⚠️", workspaceLogPath);
                        requestKernelExit(currentKernelPort);
                        bootWindow.destroy();
                        resolve(false);
                        progressing = true;
                        break;
                    }
                    try {
                        const progressResult = await net.fetch(getServer(currentKernelPort) + "/api/system/bootProgress");
                        const progressData = await progressResult.json();
                        if (progressData.data.progress >= 100) {
                            // 内核完成后等待动画快进收尾（200ms）再进入主窗口
                            await sleep(200);
                            resolve(currentKernelPort);
                            progressing = true;
                        } else {
                            await sleep(100);
                        }
                    } catch (e) {
                        writeLog("get boot progress failed: " + e.message);
                        requestKernelExit(currentKernelPort);
                        bootWindow.destroy();
                        resolve(false);
                        progressing = true;
                    }
                }
            }
        } else {
            writeLog(`get kernel version failed: ${apiData.code}, ${apiData.msg}`);
            resolve(false);
        }
    });
};

const fetchWithTimeout = async (url, options = {}, timeout = 5000) => {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeout);
    try {
        return await session.defaultSession.fetch(url, Object.assign({
            credentials: "include",
            bypassCustomProtocolHandlers: true,
            redirect: "manual",
        }, options, {signal: abortController.signal}));
    } finally {
        clearTimeout(timer);
    }
};

const requestRemoteKernelVersion = async (target) => {
    const response = await fetchWithTimeout(target.origin + "/api/system/version", {method: "GET"});
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error("version request returned HTTP " + response.status);
    }
    return response.json();
};

const isRemoteKernelAuthenticated = async (target) => {
    const response = await fetchWithTimeout(target.origin + "/stage/build/app/", {
        method: "GET",
        redirect: "manual",
    });
    if (response.status === 401 || response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        return false;
    }
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error("authentication probe returned HTTP " + response.status);
    }
    await response.body?.cancel();
    return true;
};

const initRemoteKernel = async (target) => {
    createBootWindow();
    if (!await showAppleSiliconWarning(getArg("--lang") || "")) {
        bootWindow.destroy();
        app.quit();
        return;
    }
    loadBootWindow();
    if (openAsHidden) {
        bootWindow.minimize();
    } else {
        bootWindow.show();
    }

    try {
        await session.defaultSession.clearStorageData({
            origin: target.origin,
            storages: remoteKernelActiveStorageTypes,
        });
    } catch (error) {
        throw new Error("failed to clear remote kernel active storage: " + error.message);
    }

    writeLog("connecting to remote kernel [origin=" + target.origin + "]");
    let versionData;
    for (let count = 0; count < 5; count++) {
        try {
            versionData = await requestRemoteKernelVersion(target);
            break;
        } catch (error) {
            writeLog("get remote kernel version failed: " + error.message);
            if (count < 4) {
                await sleep(500);
            }
        }
    }
    const versionStatus = getRemoteKernelVersionStatus(versionData, appVer);
    if (versionStatus === "invalid") {
        showErrorWindow("连接远程内核失败", "Failed to connect to the remote kernel",
            "<div>无法连接远程内核，请检查地址、网络和 TLS 证书。</div>" +
            "<div>Unable to connect to the remote kernel. Check the address, network, and TLS certificate.</div>");
        bootWindow.destroy();
        return;
    }
    writeLog("got remote kernel version [" + versionData.data + "]");
    if (versionStatus === "mismatch") {
        const remoteVersion = escapeHTML(versionData.data);
        showErrorWindow("远程内核版本不匹配", "Remote kernel version mismatch",
            "<div>客户端版本 " + appVer + " 与远程内核版本 " + remoteVersion + " 不一致。</div>" +
            "<div>Client version " + appVer + " does not match remote kernel version " + remoteVersion + ".</div>");
        bootWindow.destroy();
        return;
    }

    const bootShowStart = Date.now();
    let booted = false;
    while (Date.now() - bootShowStart <= 300000) {
        try {
            const response = await fetchWithTimeout(target.origin + "/api/system/bootProgress");
            if (!response.ok) {
                await response.body?.cancel();
                throw new Error("boot progress request returned HTTP " + response.status);
            }
            const progressData = await response.json();
            if (progressData?.data?.progress >= 100) {
                booted = true;
                break;
            }
        } catch (error) {
            writeLog("get remote boot progress failed: " + error.message);
        }
        await sleep(500);
    }
    if (!booted) {
        showErrorWindow("连接远程内核超时", "Remote kernel connection timed out",
            "<div>等待远程内核完成启动超时。</div><div>Timed out waiting for the remote kernel to finish booting.</div>");
        bootWindow.destroy();
        return;
    }

    let authenticated;
    try {
        authenticated = await isRemoteKernelAuthenticated(target);
    } catch (error) {
        writeLog("probe remote kernel authentication failed: " + error.message);
        showErrorWindow("检查远程内核鉴权失败", "Failed to check remote kernel authentication",
            "<div>无法检查远程内核的鉴权状态。</div><div>Unable to check the remote kernel authentication state.</div>");
        bootWindow.destroy();
        return;
    }
    installRemoteFrontendProtocol(target);
    return {
        target,
        authenticated,
    };
};

app.whenReady().then(() => {
    if ("darwin" === process.platform) {
        Menu.setApplicationMenu(Menu.buildFromTemplate([{role: "appMenu"}]));
    } else {
        setNonDarwinApplicationMenu();
    }
    // 仅本进程启动的本地内核允许自签名证书，远程内核始终使用系统信任链。
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
        const kernelMode = remoteKernelTarget ? "remote" : "local";
        if (shouldTrustLocalKernelCertificate(kernelMode, request.hostname)) {
            callback(0); // 验证通过
        } else {
            callback(-3); // 交由 Chromium 默认处理
        }
    });

    // 渲染进程崩溃监听，只有工作空间主窗口的非预期崩溃才会触发安全模式。
    app.on("render-process-gone", (event, webContents, details) => {
        writeLog("Render process gone [reason=" + details.reason + ", exitCode=" + details.exitCode + "]");
        if (updateInstallPromise) {
            writeLog("ignore renderer exit during update [webContentsId=" + webContents.id + "]");
            return;
        }
        if (systemShutdownState !== systemShutdownNone) {
            writeLog("ignore renderer exit during system shutdown [webContentsId=" + webContents.id + "]");
            return;
        }
        if (expectedRendererExitIds.delete(webContents.id)) {
            writeLog("ignore expected renderer exit [webContentsId=" + webContents.id + "]");
            return;
        }

        if (bootWindow && !bootWindow.isDestroyed() && bootWindow.webContents.id === webContents.id) {
            if (!bootAppearanceFallback) {
                writeLog("boot renderer exited, reload without custom appearance");
                loadBootWindow(true);
            }
            return;
        }

        const workspace = workspaces.find((item) => item.webContentsId === webContents.id);
        if (!workspace) {
            writeLog("ignore non-workspace renderer exit [webContentsId=" + webContents.id + "]");
            return;
        }
        if (!safeModeReasons.has(details.reason)) {
            writeLog("ignore renderer exit reason [reason=" + details.reason + "]");
            return;
        }
        if (handledCrashWebContents.has(webContents.id)) {
            return;
        }

        handledCrashWebContents.add(webContents.id);
        if (!workspace.ownsKernel) {
            writeLog("remote renderer exited without stopping the remote kernel [origin=" +
                workspace.kernelTarget.origin + "]");
            exitWorkspace(workspace);
            return;
        }
        writeAppCrashMarker(workspace, details);
        requestKernelExit(workspace.port, {
            force: true,
            setCurrentWorkspace: false,
        });
        exitApp(workspace.port); // 退出崩溃的工作空间，下次启动时由用户选择启动方式。
    });

    const resetTrayMenu = (tray, lang, mainWindow) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            return;
        }

        const trayMenuTemplate = [{
            label: mainWindow.isVisible() ? lang.hideWindow : lang.showWindow, click: () => {
                showHideWindow(tray, lang, mainWindow);
            },
        }, {
            label: lang.officialWebsite, click: () => {
                shell.openExternal("https://b3log.org/siyuan/");
            },
        }, {
            label: lang.openSource, click: () => {
                shell.openExternal("https://github.com/siyuan-note/siyuan");
            },
        }, {
            label: lang.resetWindow, type: "checkbox", click: v => {
                resetWindowStateOnRestart = v.checked;
                mainWindow.webContents.send("siyuan-save-close", true);
            },
        }, {
            label: lang.quit, click: () => {
                mainWindow.webContents.send("siyuan-save-close", true);
            },
        },];

        if ("win32" === process.platform) {
            // Windows 端支持窗口置顶 https://github.com/siyuan-note/siyuan/issues/6860
            trayMenuTemplate.splice(1, 0, {
                label: mainWindow.isAlwaysOnTop() ? lang.cancelWindowTop : lang.setWindowTop, click: () => {
                    if (!mainWindow.isAlwaysOnTop()) {
                        mainWindow.setAlwaysOnTop(true);
                    } else {
                        mainWindow.setAlwaysOnTop(false);
                    }
                    resetTrayMenu(tray, lang, mainWindow);
                },
            });
        }
        const contextMenu = Menu.buildFromTemplate(trayMenuTemplate);
        tray.setContextMenu(contextMenu);
    };
    const showHideWindow = (tray, lang, mainWindow) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            return;
        }

        if (!mainWindow.isVisible()) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.show();
        } else {
            hideWindow(mainWindow);
        }

        resetTrayMenu(tray, lang, mainWindow);
    };
    // 由渲染进程同步 macOS 应用菜单的文案与快捷键
    ipcMain.on("siyuan-sync-app-menu", (event, sync) => {
        if ("darwin" !== process.platform) {
            return;
        }
        if (!sync || !sync.i18n || typeof sync.i18n !== "object" || !sync.hotkey || typeof sync.hotkey !== "object") {
            return;
        }
        const kernelTarget = getWindowKernelTarget(event.sender.id);
        const workspaceDir = kernelTarget?.mode === "remote"
            ? "remote:" + kernelTarget.origin
            : (typeof sync.workspaceDir === "string" && sync.workspaceDir)
                ? sync.workspaceDir
                : ("webContents:" + event.sender.id);
        appMenuByWorkspaceDir.set(workspaceDir, sync);
        appMenuWorkspaceByWebContentsId.set(event.sender.id, workspaceDir);
        if (shouldApplyAppMenuFrom(event.sender.id, workspaceDir)) {
            applyMacAppMenu(sync);
        }
    });

    const getWindowByContentId = (id) => {
        return BrowserWindow.getAllWindows().find((win) => win.webContents.id === id);
    };
    ipcMain.on("siyuan-context-menu", (event, langs) => {
        pendingSpellcheckRequests.delete(event.sender.id);
        pendingNativeContextMenuRequests.set(event.sender.id, langs);
        dispatchContextMenuRequests(event.sender);
        setTimeout(() => {
            if (pendingNativeContextMenuRequests.get(event.sender.id) === langs) {
                pendingNativeContextMenuRequests.delete(event.sender.id);
                if (!event.sender.isDestroyed()) {
                    popupNativeTextContextMenu(event.sender, undefined, langs);
                }
            }
        }, 100);
    });
    ipcMain.on("siyuan-spellcheck-context", (event, position) => {
        pendingNativeContextMenuRequests.delete(event.sender.id);
        pendingSpellcheckRequests.set(event.sender.id, position);
        dispatchContextMenuRequests(event.sender);
        setTimeout(() => {
            if (pendingSpellcheckRequests.get(event.sender.id) === position) {
                pendingSpellcheckRequests.delete(event.sender.id);
            }
        }, 200);
    });
    ipcMain.handle("siyuan-spellcheck-action", (event, data) => {
        const context = spellcheckContexts.get(event.sender.id);
        if (!context || context.contextId !== data.contextId || !context.params.misspelledWord) {
            return false;
        }
        if (data.action === "replace") {
            if (typeof data.suggestion !== "string" ||
                !context.params.dictionarySuggestions.includes(data.suggestion)) {
                return false;
            }
            event.sender.replaceMisspelling(data.suggestion);
            spellcheckContexts.delete(event.sender.id);
            return true;
        }
        if (data.action === "addToDictionary") {
            const result = event.sender.session.addWordToSpellCheckerDictionary(context.params.misspelledWord);
            spellcheckContexts.delete(event.sender.id);
            return result;
        }
        return false;
    });
    ipcMain.on("siyuan-confirm-dialog", (event, options) => {
        event.returnValue = dialog.showMessageBoxSync(BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow(), options);
    });
    ipcMain.on("siyuan-alert-dialog", (event, options) => {
        dialog.showMessageBoxSync(BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow(), options);
        event.returnValue = undefined;
    });
    ipcMain.on("siyuan-first-quit", () => {
        app.exit();
    });
    ipcMain.handle("siyuan-get", (event, data) => {
        const remoteSender = getWindowKernelTarget(event.sender.id)?.mode === "remote";
        if (remoteSender && ["beginRichClipboard", "completeRichClipboard", "cancelRichClipboard", "clipboardRead"]
            .includes(data.cmd)) {
            writeLog("ignored local file clipboard processing in remote kernel mode");
            return false;
        }
        if (remoteSender && data.cmd === "showOpenDialog") {
            writeLog("ignored local open dialog in remote kernel mode");
            return {canceled: true, filePaths: []};
        }
        if (remoteSender && data.cmd === "showSaveDialog") {
            writeLog("ignored local save dialog in remote kernel mode");
            return {canceled: true, filePath: ""};
        }
        if (remoteSender && data.cmd === "printToPDF") {
            writeLog("ignored local PDF export in remote kernel mode");
            return;
        }
        if (remoteSender && data.cmd === "setProxy") {
            writeLog("ignored applying a server proxy to the remote client");
            return false;
        }
        if (data.cmd === "clipboardRead") {
            return clipboard.read(data.format);
        }
        if (data.cmd === "clipboardReadMathML") {
            if (typeof data.text !== "string" ||
                normalizeClipboardText(clipboard.readText()) !== normalizeClipboardText(data.text)) {
                return "";
            }
            const formats = clipboard.availableFormats().filter((format) =>
                /^mathml(?: presentation)?$/i.test(format));
            formats.push("MathML", "MathML Presentation");
            // availableFormats 可能不包含 Office 原生 MathML 格式，需要直接尝试标准格式名
            for (const format of new Set(formats)) {
                const buffer = clipboard.readBuffer(format);
                if (buffer.length === 0 || buffer.length > 1024 * 1024 || buffer.length % 2 !== 0) {
                    continue;
                }
                const mathML = buffer.toString("utf16le")
                    .replace(/^\uFEFF/, "")
                    .replace(/\0+$/, "")
                    .trim();
                if (/<(?:[A-Za-z_][\w.-]*:)?math(?:\s|>)/i.test(mathML)) {
                    return mathML;
                }
            }
            return "";
        }
        if (data.cmd === "clipboardReadOffice") {
            if (typeof data.text !== "string" ||
                normalizeClipboardText(clipboard.readText()) !== normalizeClipboardText(data.text)) {
                return "";
            }
            const buffer = clipboard.readBuffer("Embed Source");
            const compoundFileSignature = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
            if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024 ||
                !buffer.subarray(0, compoundFileSignature.length).equals(compoundFileSignature)) {
                return "";
            }
            return buffer.toString("base64");
        }
        if (data.cmd === "clipboardReadWPS") {
            if (typeof data.text !== "string" ||
                normalizeClipboardText(clipboard.readText()) !== normalizeClipboardText(data.text)) {
                return "";
            }
            const formats = clipboard.availableFormats().filter((format) =>
                /kingsoft.*wps.*format/i.test(format));
            formats.push("Kingsoft WPS Format");
            for (let version = 6; version <= 20; version++) {
                formats.push(`Kingsoft WPS ${version}.0 Format`);
            }
            // availableFormats 可能不包含 WPS 原生格式，需要尝试常见格式名
            for (const format of new Set(formats)) {
                const buffer = clipboard.readBuffer(format);
                if (buffer.length <= 8 * 1024 * 1024 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
                    return buffer.toString("base64");
                }
            }
            return "";
        }
        if (data.cmd === "beginRichClipboard") {
            richClipboardOperation = undefined;
            const text = clipboard.readText();
            const html = clipboard.readHTML();
            if (typeof data.text !== "string" || typeof data.marker !== "string" ||
                normalizeClipboardText(text) !== normalizeClipboardText(data.text) ||
                !data.marker || !html.includes(data.marker)) {
                return;
            }

            richClipboardSequence++;
            const token = `${Date.now()}-${richClipboardSequence}`;
            richClipboardOperation = {
                token,
                senderId: event.sender.id,
                requestedText: data.text,
                text,
                html
            };
            return token;
        }
        if (data.cmd === "completeRichClipboard") {
            const operation = richClipboardOperation;
            if (!operation || operation.token !== data.token || operation.senderId !== event.sender.id) {
                return false;
            }
            if (operation.requestedText !== data.text || clipboard.readText() !== operation.text ||
                clipboard.readHTML() !== operation.html || typeof data.html !== "string" ||
                !Array.isArray(data.replacements) || 1024 < data.replacements.length) {
                richClipboardOperation = undefined;
                return false;
            }

            let html = data.html;
            for (const replacement of data.replacements) {
                let isFile = false;
                if (replacement && typeof replacement.path === "string" && path.isAbsolute(replacement.path)) {
                    try {
                        isFile = fs.statSync(replacement.path).isFile();
                    } catch {
                        isFile = false;
                    }
                }
                if (!replacement || typeof replacement.placeholder !== "string" || !replacement.placeholder ||
                    !isFile || !html.includes(replacement.placeholder)) {
                    richClipboardOperation = undefined;
                    return false;
                }
                const fileURL = pathToFileURL(replacement.path).href.replaceAll("&", "&amp;");
                html = html.split(replacement.placeholder).join(fileURL);
            }

            richClipboardOperation = undefined;
            clipboard.write({
                text: data.text,
                html
            });
            return true;
        }
        if (data.cmd === "cancelRichClipboard") {
            if (richClipboardOperation?.token === data.token && richClipboardOperation.senderId === event.sender.id) {
                richClipboardOperation = undefined;
            }
        }
        if (data.cmd === "showOpenDialog") {
            if (data.singleton) {
                const singleton = `${event.sender.id}:${data.singleton}`;
                if (openDialogSingletons.has(singleton)) {
                    return {canceled: true, filePaths: []};
                }
                openDialogSingletons.add(singleton);
                const options = {...data};
                delete options.cmd;
                delete options.singleton;
                return dialog.showOpenDialog(options).finally(() => {
                    openDialogSingletons.delete(singleton);
                });
            }
            return dialog.showOpenDialog(data);
        }
        if (data.cmd === "getContentsId") {
            return event.sender.id;
        }
        if (data.cmd === "isAlwaysOnTop") {
            const wnd = getWindowByContentId(event.sender.id);
            if (!wnd) {
                return false;
            }
            return wnd.isAlwaysOnTop();
        }
        if (data.cmd === "availableSpellCheckerLanguages") {
            return event.sender.session.availableSpellCheckerLanguages;
        }
        if (data.cmd === "setProxy") {
            return setProxy(data.proxyURL, event.sender, data.proxyMode);
        }
        if (data.cmd === "showSaveDialog") {
            return dialog.showSaveDialog(data);
        }
        if (data.cmd === "isFullScreen") {
            const wnd = getWindowByContentId(event.sender.id);
            if (!wnd) {
                return false;
            }
            return wnd.isFullScreen();
        }
        if (data.cmd === "isMaximized") {
            const wnd = getWindowByContentId(event.sender.id);
            if (!wnd) {
                return false;
            }
            return wnd.isMaximized();
        }
        if (data.cmd === "getMicrophone") {
            return systemPreferences.getMediaAccessStatus("microphone");
        }
        if (data.cmd === "askMicrophone") {
            return systemPreferences.askForMediaAccess("microphone");
        }
        if (data.cmd === "printToPDF") {
            try {
                return getWindowByContentId(data.webContentsId).webContents.printToPDF(data.pdfOptions);
            } catch (e) {
                writeLog("printToPDF: ", e);
                throw e;
            }
        }
        if (data.cmd === "siyuan-open-file") {
            const options = JSON.parse(data.options);
            return BrowserWindow.getAllWindows().some(item => {
                if (item.isDestroyed() || item.webContents.isDestroyed() ||
                    item.webContents.id === event.sender.id) {
                    return false;
                }

                let url;
                let ids;
                try {
                    const currentURL = item.webContents.getURL();
                    if (!currentURL) {
                        return false;
                    }
                    url = new URL(currentURL);
                    ids = decodeURIComponent(url.hash.substring(1)).split("\u200b");
                } catch {
                    return false;
                }
                if (data.port !== url.port) {
                    return false;
                }
                if (ids.includes(options.rootID) || ids.includes(options.assetPath)) {
                    item.focus();
                    item.webContents.send("siyuan-open-file", options);
                    return true;
                }
                return false;
            });
        }
    });

    ipcMain.on("siyuan-event", (event) => {
        if (initEventId.includes(event.sender.id)) {
            return;
        }
        initEventId.push(event.sender.id);
        const currentWindow = getWindowByContentId(event.sender.id);
        if (!currentWindow) {
            return;
        }
        latestActiveWindow = currentWindow;
        applyMacAppMenuForWindow(currentWindow);
        const webContentsId = currentWindow.webContents.id;
        currentWindow.on("closed", () => {
            forgetAppMenuWebContents(webContentsId);
        });
        currentWindow.on("focus", () => {
            event.sender.send("siyuan-event", "focus");
            latestActiveWindow = currentWindow;
            applyMacAppMenuForWindow(currentWindow);
        });
        currentWindow.on("blur", () => {
            event.sender.send("siyuan-event", "blur");
        });
        if ("darwin" !== process.platform) {
            currentWindow.on("maximize", () => {
                event.sender.send("siyuan-event", "maximize");
            });
            currentWindow.on("unmaximize", () => {
                event.sender.send("siyuan-event", "unmaximize");
            });
        }
        currentWindow.on("enter-full-screen", () => {
            event.sender.send("siyuan-event", "enter-full-screen");
        });
        currentWindow.on("leave-full-screen", () => {
            event.sender.send("siyuan-event", "leave-full-screen");
        });
    });
    ipcMain.on("siyuan-cmd", (event, data) => {
        let cmd = data;
        let webContentsId = event.sender.id;
        if (typeof data !== "string") {
            cmd = data.cmd;
            if (data.webContentsId) {
                webContentsId = data.webContentsId;
            }
        }
        const currentWindow = getWindowByContentId(webContentsId);
        const remoteSender = getWindowKernelTarget(event.sender.id)?.mode === "remote";
        switch (cmd) {
            case "showItemInFolder":
                if (remoteSender) {
                    writeLog("ignored showing a server path in remote kernel mode");
                    break;
                }
                shell.showItemInFolder(data.filePath);
                break;
            case "notification": {
                const n = new Notification({
                    title: data.title,
                    body: data.body,
                    timeoutType: data.timeoutType,
                });
                n.on("click", () => {
                    currentWindow.focus();
                    currentWindow.show();
                });
                n.show();
                break;
            }
            case "setSpellCheckerLanguages":
                BrowserWindow.getAllWindows().forEach(item => {
                    item.webContents.session.setSpellCheckerLanguages(data.languages);
                });
                break;
            case "openPath":
                if (remoteSender) {
                    writeLog("ignored opening a server path in remote kernel mode");
                    break;
                }
                shell.openPath(data.filePath);
                break;
            case "openDevTools": {
                /** @type {import("electron").OpenDevToolsOptions} */
                const options = {};
                if (["left", "right", "bottom", "undocked", "detach"].includes(data.mode)) {
                    options.mode = data.mode;
                }
                if (typeof data.activate === "boolean") {
                    options.activate = data.activate;
                }
                if (typeof data.title === "string") {
                    options.title = data.title;
                }
                event.sender.openDevTools(options);
                break;
            }
            case "toggleDevTools":
                event.sender.toggleDevTools();
                break;
            case "unregisterGlobalShortcut": {
                const workspaceItem = workspaces.find(item => item.webContentsId === event.sender.id);
                if (!workspaceItem) {
                    break;
                }
                if (data.accelerator) {
                    globalShortcut.unregister(hotKey2Electron(data.accelerator));
                }
                break;
            }
            case "registerGlobalShortcut": {
                const workspaceItem = workspaces.find(item => item.webContentsId === event.sender.id);
                if (!workspaceItem) {
                    break;
                }
                if (data.accelerator) {
                    globalShortcut.unregister(hotKey2Electron(data.accelerator));
                    globalShortcut.register(hotKey2Electron(data.accelerator), () => {
                        const targetWorkspace = getGlobalShortcutWorkspace(workspaceItem);
                        if (targetWorkspace) {
                            targetWorkspace.browserWindow.webContents.send("siyuan-hotkey", {
                                hotkey: data.accelerator
                            });
                        }
                    });
                }
                break;
            }
            case "setTrafficLightPosition":
                if (!currentWindow || !currentWindow.setWindowButtonPosition) {
                    return;
                }
                if (new URL(currentWindow.getURL()).pathname === "/stage/build/app/window.html") {
                    data.position.y += 5 * data.zoom;
                }
                currentWindow.setWindowButtonPosition(data.position);
                break;
            case "show":
                if (!currentWindow) {
                    return;
                }
                showWindow(currentWindow);
                break;
            case "hide":
                if (!currentWindow) {
                    return;
                }
                currentWindow.hide();
                break;
            case "minimize":
                if (!currentWindow) {
                    return;
                }
                currentWindow.minimize();
                break;
            case "maximize":
                if (!currentWindow) {
                    return;
                }
                currentWindow.maximize();
                break;
            case "restore":
                if (!currentWindow) {
                    return;
                }
                if (currentWindow.isFullScreen()) {
                    currentWindow.setFullScreen(false);
                } else {
                    currentWindow.unmaximize();
                }
                break;
            case "focus":
                if (!currentWindow) {
                    return;
                }
                currentWindow.focus();
                break;
            case "setAlwaysOnTopFalse":
                if (!currentWindow) {
                    return;
                }
                currentWindow.setAlwaysOnTop(false);
                break;
            case "setAlwaysOnTopTrue":
                if (!currentWindow) {
                    return;
                }
                currentWindow.setAlwaysOnTop(true);
                break;
            case "clearCache":
                event.sender.session.clearCache();
                break;
            case "redo":
                event.sender.redo();
                break;
            case "undo":
                event.sender.undo();
                break;
            case "destroy":
                if (!currentWindow) {
                    return;
                }
                currentWindow.destroy();
                break;
            case "writeLog":
                writeLog(data.msg);
                break;
            case "closeButtonBehavior":
                if (!currentWindow) {
                    return;
                }
                if (currentWindow.isFullScreen()) {
                    currentWindow.once("leave-full-screen", () => {
                        currentWindow.hide();
                    });
                    currentWindow.setFullScreen(false);
                } else {
                    currentWindow.hide();
                }
                break;
        }
    });
    ipcMain.on("siyuan-config-tray", (event, data) => {
        workspaces.find(item => {
            if (item.browserWindow.webContents.id === event.sender.id) {
                hideWindow(item.browserWindow);
                if ("win32" === process.platform || "linux" === process.platform) {
                    resetTrayMenu(item.tray, data.languages, item.browserWindow);
                }
                return true;
            }
        });
    });
    ipcMain.on("siyuan-export-pdf", (event, data) => {
        if (getWindowKernelTarget(event.sender.id)?.mode === "remote") {
            writeLog("ignored local PDF export in remote kernel mode");
            return;
        }
        data.webContentsId = event.sender.id;
        getWindowByContentId(data.parentWindowId).send("siyuan-export-pdf", data);
    });
    ipcMain.on("siyuan-export-newwindow", (event, data) => {
        const kernelTarget = getWindowKernelTarget(event.sender.id);
        if (kernelTarget?.mode === "remote") {
            writeLog("ignored local PDF export window for remote kernel");
            return;
        }
        // The PDF/Word export preview window automatically adjusts according to the size of the main window https://github.com/siyuan-note/siyuan/issues/10554
        const wndBounds = getWindowByContentId(event.sender.id).getBounds();
        const wndScreen = screen.getDisplayNearestPoint({x: wndBounds.x, y: wndBounds.y});
        const printWin = new BrowserWindow({
            title: "SiYuan",
            show: true,
            width: Math.floor(wndScreen.size.width * 0.8),
            height: Math.floor(wndScreen.size.height * 0.8),
            resizable: true,
            frame: "darwin" === process.platform,
            icon: path.join(appDir, "stage", "icon-large.png"),
            titleBarStyle: "hidden",
            webPreferences: {
                contextIsolation: false,
                nodeIntegration: true,
                webviewTag: true,
                webSecurity: false,
                autoplayPolicy: "user-gesture-required" // 桌面端禁止自动播放多媒体 https://github.com/siyuan-note/siyuan/issues/7587
            },
        });
        printWin.center();
        rememberWindowKernelTarget(printWin, kernelTarget || createLocalKernelTarget());
        printWin.webContents.userAgent = "SiYuan/" + appVer + " https://b3log.org/siyuan Electron " + printWin.webContents.userAgent;
        printWin.loadURL(data);
        windowNavigate(printWin, "export", (kernelTarget || createLocalKernelTarget()).origin);
    });
    ipcMain.on("siyuan-quit", (event, port) => {
        const kernelTarget = getWindowKernelTarget(event.sender.id);
        const workspace = workspaces.find((item) => item.webContentsId === event.sender.id);
        if (kernelTarget?.mode === "remote") {
            if (workspace) {
                exitWorkspace(workspace);
            } else {
                const senderWindow = BrowserWindow.fromWebContents(event.sender);
                markExpectedRendererExit(senderWindow);
                senderWindow?.destroy();
            }
            return;
        }
        exitApp(port);
    });
    ipcMain.handle("siyuan-install-update", (event, data) => {
        return beginUpdateInstall(event, data);
    });
    ipcMain.on("siyuan-show-window", (event) => {
        const mainWindow = getWindowByContentId(event.sender.id);
        if (!mainWindow) {
            return;
        }

        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.show();
    });
    ipcMain.on("siyuan-open-window", (event, data) => {
        const kernelTarget = getWindowKernelTarget(event.sender.id);
        if (!kernelTarget) {
            writeLog("ignored opening a window without a kernel target");
            return;
        }
        let windowURL;
        try {
            windowURL = new URL(data.url);
        } catch (error) {
            writeLog("ignored opening a window with an invalid URL");
            return;
        }
        if (windowURL.origin !== kernelTarget.origin || windowURL.pathname !== "/stage/build/app/window.html") {
            writeLog("ignored opening a window outside the kernel origin");
            return;
        }
        if (kernelTarget.mode === "remote") {
            windowURL.searchParams.set("remote", "1");
        }
        const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        const mainBounds = mainWindow.getBounds();
        const mainScreen = screen.getDisplayNearestPoint({x: mainBounds.x, y: mainBounds.y});
        const win = new BrowserWindow({
            title: "SiYuan",
            show: true,
            trafficLightPosition: {x: 8, y: 13},
            width: Math.floor(data.width || mainScreen.size.width * 0.7),
            height: Math.floor(data.height || mainScreen.size.height * 0.9),
            minWidth: 493,
            minHeight: 376,
            fullscreenable: true,
            frame: "darwin" === process.platform,
            icon: path.join(appDir, "stage", "icon-large.png"),
            titleBarStyle: "hidden",
            webPreferences: {
                contextIsolation: false,
                nodeIntegration: true,
                nodeIntegrationInSubFrames: false,
                nodeIntegrationInWorker: false,
                webviewTag: kernelTarget.mode !== "remote",
                webSecurity: kernelTarget.mode === "remote",
                autoplayPolicy: "user-gesture-required" // 桌面端禁止自动播放多媒体 https://github.com/siyuan-note/siyuan/issues/7587
            },
        });
        remote.enable(win.webContents);
        bindSpellcheckContextMenu(win.webContents);
        rememberWindowKernelTarget(win, kernelTarget);

        if (data.position) {
            win.setPosition(data.position.x, data.position.y);
        } else {
            win.center();
        }
        win.setAlwaysOnTop(data.alwaysOnTop);
        win.webContents.userAgent = "SiYuan/" + appVer + " https://b3log.org/siyuan Electron " + win.webContents.userAgent;
        win.webContents.session.setSpellCheckerLanguages(["en-US"]);
        win.loadURL(windowURL.href);
        windowNavigate(win, "window", kernelTarget.origin, kernelTarget.mode === "remote");
        win.on("close", (event) => {
            if (kernelTarget.mode === "remote" && (getWindowPathname(win) !== "/stage/build/app/window.html" ||
                !initializedWindowIds.has(win.webContents.id))) {
                event.preventDefault();
                markExpectedRendererExit(win);
                win.destroy();
                return;
            }
            if (win && !win.isDestroyed()) {
                win.webContents.send("siyuan-save-close");
            }
            event.preventDefault();
        });
        const targetScreen = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        if (mainScreen.id !== targetScreen.id) {
            win.setBounds(targetScreen.workArea);
        }
    });
    ipcMain.on("siyuan-open-workspace", (event, data) => {
        if (getWindowKernelTarget(event.sender.id)?.mode === "remote") {
            writeLog("ignored opening a local workspace in remote kernel mode");
            return;
        }
        if (updateInstallPromise) {
            writeLog("ignored opening workspace while installing update");
            return;
        }
        const foundWorkspace = workspaces.find((item) => {
            if (item.workspaceDir === data.workspace) {
                showWindow(item.browserWindow);
                return true;
            }
        });
        if (!foundWorkspace) {
            initKernel(data.workspace, "", "").then((startedKernelPort) => {
                if (startedKernelPort) {
                    initMainWindow(startedKernelPort);
                }
            });
        }
    });
    ipcMain.handle("siyuan-init", async (event, data) => {
        const kernelTarget = getWindowKernelTarget(event.sender.id);
        if (kernelTarget) {
            initializedWindowIds.add(event.sender.id);
        }
        const capabilities = kernelTarget ? {
            kernelMode: kernelTarget.mode,
            ownsKernel: kernelTarget.ownsKernel,
            kernelOrigin: kernelTarget.origin,
        } : undefined;
        const exitWS = workspaces.find(item => {
            if (event.sender.id === item.webContentsId && item.initialized) {
                if (item.tray && ("win32" === process.platform || "linux" === process.platform)) {
                    // Tray menu text does not change with the appearance language https://github.com/siyuan-note/siyuan/issues/7935
                    resetTrayMenu(item.tray, data.languages, item.browserWindow);
                }
                return true;
            }
        });
        if (exitWS) {
            if (!exitWS.ownsKernel) {
                setTimeout(() => flushPendingRemoteOpenURLs(exitWS.browserWindow), 100);
            }
            return capabilities;
        }

        const workspaceItem = workspaces.find((item) => event.sender.id === item.webContentsId);
        if (workspaceItem) {
            workspaceItem.initialized = true;
            workspaceItem.workspaceDir = workspaceItem.ownsKernel ? data.workspaceDir : "";
            let tray;
            if ("win32" === process.platform || "linux" === process.platform) {
                // 系统托盘
                tray = new Tray(path.join(appDir, "stage", "icon-large.png"));
                const trayName = workspaceItem.ownsKernel ? path.basename(data.workspaceDir) :
                    new URL(workspaceItem.kernelTarget.origin).host;
                tray.setToolTip(`${trayName} - SiYuan v${appVer}`);
                const mainWindow = getWindowByContentId(event.sender.id);
                if (!mainWindow || mainWindow.isDestroyed()) {
                    tray.destroy();
                    tray = undefined;
                } else {
                    resetTrayMenu(tray, data.languages, mainWindow);
                    tray.on("click", () => {
                        showHideWindow(tray, data.languages, mainWindow);
                    });
                }
            }
            workspaceItem.tray = tray;
        }
        if (workspaceItem?.ownsKernel) {
            await net.fetch(workspaceItem.kernelTarget.origin + "/api/system/uiproc?pid=" + process.pid, {method: "POST"});
        } else if (workspaceItem) {
            setTimeout(() => flushPendingRemoteOpenURLs(workspaceItem.browserWindow), 100);
        }
        return capabilities;
    });
    ipcMain.on("siyuan-hotkey", (event, data) => {
        if (!data.hotkeys || data.hotkeys.length === 0) {
            return;
        }
        const ownerWorkspace = workspaces.find(workspaceItem =>
            event.sender.id === workspaceItem.browserWindow.webContents.id);
        if (!ownerWorkspace) {
            return;
        }
        ownerWorkspace.hotkeys = data.hotkeys;
        data.hotkeys.forEach((item, index) => {
            const shortcut = hotKey2Electron(item);
            if (!shortcut) {
                return;
            }
            if (globalShortcut.isRegistered(shortcut)) {
                globalShortcut.unregister(shortcut);
            }
            if (index === 0) {
                globalShortcut.register(shortcut, () => {
                    let currentWorkspace;
                    const currentWebContentsId = (latestActiveWindow && !latestActiveWindow.isDestroyed()) ? latestActiveWindow.webContents.id : undefined;
                    workspaces.find(workspaceItem => {
                        if (currentWebContentsId === workspaceItem.browserWindow.webContents.id && workspaceItem.hotkeys[0] === item) {
                            currentWorkspace = workspaceItem;
                            return true;
                        }
                    });
                    if (!currentWorkspace) {
                        workspaces.find(workspaceItem => {
                            if (workspaceItem.hotkeys[0] === item && event.sender.id === workspaceItem.browserWindow.webContents.id) {
                                currentWorkspace = workspaceItem;
                                return true;
                            }
                        });
                    }
                    if (!currentWorkspace) {
                        return;
                    }
                    const mainWindow = currentWorkspace.browserWindow;
                    toggleMainWindow(mainWindow);
                    if ("win32" === process.platform || "linux" === process.platform) {
                        resetTrayMenu(currentWorkspace.tray, data.languages, mainWindow);
                    }
                });
            } else {
                globalShortcut.register(shortcut, () => {
                    const targetWorkspace = getGlobalShortcutWorkspace(ownerWorkspace);
                    if (targetWorkspace) {
                        targetWorkspace.browserWindow.webContents.send("siyuan-hotkey", {
                            hotkey: item
                        });
                    }
                });
            }
        });
    });
    ipcMain.on("siyuan-send-windows", (event, data) => {
        BrowserWindow.getAllWindows().forEach(item => {
            item.webContents.send("siyuan-send-windows", data);
        });
    });
    ipcMain.on("siyuan-auto-launch", (event, data) => {
        const kernelTarget = getWindowKernelTarget(event.sender.id);
        const args = [];
        if (kernelTarget?.mode === "remote") {
            args.push("--remote=" + kernelTarget.origin);
        }
        if (data.openAsHidden) {
            args.push("--openAsHidden");
        }
        app.setLoginItemSettings({
            openAtLogin: data.openAtLogin,
            args,
        });
    });
    const appCrashInfo = readAppCrashInfo();
    if (remoteKernelArgError) {
        if (remoteKernelArgError.code === "ERR_REMOTE_UNSAFE_CHROMIUM_SWITCH") {
            showErrorWindow("远程内核启动参数不安全", "Unsafe remote kernel arguments",
                "<div>远程内核模式不能与弱化网页或 TLS 安全的参数同时使用。</div>" +
                "<div>Remote kernel mode cannot be used with arguments that weaken web or TLS security.</div>");
        } else {
            showErrorWindow("远程内核地址无效", "Invalid remote kernel address",
                "<div>--remote 仅接受不带路径、查询或凭据的 HTTPS origin。</div>" +
                "<div>--remote only accepts an HTTPS origin without a path, query, or credentials.</div>");
        }
    } else if (remoteKernelTarget) {
        initRemoteKernel(remoteKernelTarget).then((result) => {
            if (result) {
                initMainWindow(result.target, result.authenticated);
            }
        }).catch((error) => {
            writeLog("initialize remote kernel failed: " + error);
            if (bootWindow && !bootWindow.isDestroyed()) {
                bootWindow.destroy();
            }
            showErrorWindow("连接远程内核失败", "Failed to connect to the remote kernel",
                "<div>连接远程内核时发生意外错误。</div><div>An unexpected error occurred while connecting to the remote kernel.</div>");
        });
    } else if (firstOpen) {
        const firstOpenWindow = new BrowserWindow({
            width: Math.floor(screen.getPrimaryDisplay().size.width * 0.6),
            height: Math.floor(screen.getPrimaryDisplay().workAreaSize.height * 0.8),
            frame: "darwin" === process.platform,
            titleBarStyle: "hidden",
            fullscreenable: false,
            icon: path.join(appDir, "stage", "icon-large.png"),
            transparent: "darwin" === process.platform,
            webPreferences: {
                nodeIntegration: true, webviewTag: true, webSecurity: false, contextIsolation: false,
            },
        });
        let initHTMLPath = path.join(appDir, "app", "electron", "init.html");
        if (isDevEnv) {
            initHTMLPath = path.join(appDir, "electron", "init.html");
        }

        // 改进桌面端初始化时使用的外观语言 https://github.com/siyuan-note/siyuan/issues/6803
        const languages = app.getPreferredSystemLanguages();
        const language = resolveAppLanguage(languages);
        firstOpenWindow.loadFile(initHTMLPath, {
            query: {
                lang: language,
                home: app.getPath("home"),
                v: appVer,
                icon: path.join(appDir, "stage", "icon-large.png"),
            },
        });
        firstOpenWindow.show();
        // 初始化启动
        ipcMain.on("siyuan-first-init", (event, data) => {
            initKernel(data.workspace, "", data.lang).then((startedKernelPort) => {
                if (startedKernelPort) {
                    initMainWindow(startedKernelPort);
                }
            });
            firstOpenWindow.destroy();
        });
    } else if (appCrashInfo) {
        // 上次工作空间渲染进程崩溃，弹出安全模式选择窗口。
        const safeModeWindow = new BrowserWindow({
            width: Math.floor(screen.getPrimaryDisplay().size.width * 0.55),
            height: Math.floor(screen.getPrimaryDisplay().workAreaSize.height * 0.65),
            frame: "darwin" === process.platform,
            titleBarStyle: "hidden",
            fullscreenable: false,
            icon: path.join(appDir, "stage", "icon-large.png"),
            transparent: "darwin" === process.platform,
            webPreferences: {
                nodeIntegration: true, webviewTag: true, webSecurity: false, contextIsolation: false,
            },
        });
        let safeModeHTMLPath = path.join(appDir, "app", "electron", "workspace.html");
        if (isDevEnv) {
            safeModeHTMLPath = path.join(appDir, "electron", "workspace.html");
        }

        // 改进桌面端初始化时使用的外观语言 https://github.com/siyuan-note/siyuan/issues/6803
        const languages = app.getPreferredSystemLanguages();
        const language = resolveAppLanguage(languages);
        let crashWorkspace = appCrashInfo.workspaceDir || lastWorkspacePath;
        if (!appCrashInfo.workspaceDir && !isDirectory(crashWorkspace)) {
            crashWorkspace = availableWorkspaces[availableWorkspaces.length - 1] || lastWorkspacePath;
        }
        const crashWorkspaceMissing = !isDirectory(crashWorkspace);
        safeModeWindow.loadFile(safeModeHTMLPath, {
            query: {
                lang: language,
                home: app.getPath("home"),
                v: appVer,
                icon: path.join(appDir, "stage", "icon-large.png"),
                crash: "1",
                workspace: crashWorkspace,
                crashWorkspaceMissing: crashWorkspaceMissing ? "1" : "0",
                missing: crashWorkspaceMissing ? crashWorkspace : "",
                crashInfo: appCrashInfo.crashInfo,
            },
        });
        safeModeWindow.show();
        // 用户选择启动方式后启动内核，仅在内核启动成功后删除崩溃信息。
        ipcMain.on("siyuan-select-workspace", (event, data) => {
            initKernel(data.workspace, "", data.lang, data.safeMode).then((startedKernelPort) => {
                if (startedKernelPort) {
                    clearAppCrashInfo();
                    initMainWindow(startedKernelPort);
                }
            });
            safeModeWindow.destroy();
        });
    } else if (lastWorkspaceMissing) {
        // 上次使用的工作空间丢失，弹出选择工作空间窗口 https://github.com/siyuan-note/siyuan/issues/14748
        const missingWorkspaceWindow = new BrowserWindow({
            width: Math.floor(screen.getPrimaryDisplay().size.width * 0.55),
            height: Math.floor(screen.getPrimaryDisplay().workAreaSize.height * 0.65),
            frame: "darwin" === process.platform,
            titleBarStyle: "hidden",
            fullscreenable: false,
            icon: path.join(appDir, "stage", "icon-large.png"),
            transparent: "darwin" === process.platform,
            webPreferences: {
                nodeIntegration: true, webviewTag: true, webSecurity: false, contextIsolation: false,
            },
        });
        let missingWorkspaceHTMLPath = path.join(appDir, "app", "electron", "workspace.html");
        if (isDevEnv) {
            missingWorkspaceHTMLPath = path.join(appDir, "electron", "workspace.html");
        }

        // 改进桌面端初始化时使用的外观语言 https://github.com/siyuan-note/siyuan/issues/6803
        const languages = app.getPreferredSystemLanguages();
        const language = resolveAppLanguage(languages);
        missingWorkspaceWindow.loadFile(missingWorkspaceHTMLPath, {
            query: {
                lang: language,
                home: app.getPath("home"),
                v: appVer,
                icon: path.join(appDir, "stage", "icon-large.png"),
                missing: missingWorkspacePath,
                workspaces: availableWorkspaces.join("\n"),
            },
        });
        missingWorkspaceWindow.show();
        // 选择工作空间后启动内核
        ipcMain.on("siyuan-select-workspace", (event, data) => {
            initKernel(data.workspace, "", data.lang).then((startedKernelPort) => {
                if (startedKernelPort) {
                    initMainWindow(startedKernelPort);
                }
            });
            missingWorkspaceWindow.destroy();
        });
    } else {
        const workspace = getArg("--workspace");
        if (workspace) {
            writeLog("got arg [--workspace=" + workspace + "]");
        }
        const port = getArg("--port");
        if (port) {
            writeLog("got arg [--port=" + port + "]");
        }
        const safeMode = getArg("--safe-mode") === "true";
        if (safeMode) {
            writeLog("got arg [--safe-mode=true]");
        }
        const lang = getArg("--lang") || "";
        if (lang) {
            writeLog("got arg [--lang=" + lang + "]");
        }
        initKernel(workspace, port, lang, safeMode).then((startedKernelPort) => {
            if (startedKernelPort) {
                initMainWindow(startedKernelPort);
            }
        });
    }

    // 电源相关事件必须放在 whenReady 里面，否则会导致 Linux 端无法正常启动 Trace/breakpoint trap (core dumped) https://github.com/siyuan-note/siyuan/issues/9347
    powerMonitor.on("suspend", () => {
        writeLog("system suspend");
    });
    powerMonitor.on("resume", async () => {
        // 桌面端系统休眠唤醒后判断网络连通性后再执行数据同步 https://github.com/siyuan-note/siyuan/issues/6687
        writeLog("system resume");

        const isOnline = async () => {
            return net.isOnline();
        };
        let online = false;
        for (let i = 0; i < 7; i++) {
            if (await isOnline()) {
                online = true;
                break;
            }

            writeLog("network is offline");
            await sleep(1000);
        }

        if (!online) {
            writeLog("network is offline, do not sync after system resume");
            return;
        }

        workspaces.forEach(item => {
            const server = item.kernelTarget.origin;
            writeLog("sync after system resume [" + server + "/api/sync/performSync" + "]");
            session.defaultSession.fetch(server + "/api/sync/performSync", {
                method: "POST",
                credentials: item.ownsKernel ? "omit" : "include",
                bypassCustomProtocolHandlers: !item.ownsKernel,
                redirect: item.ownsKernel ? "follow" : "manual",
            });
        });
    });
    powerMonitor.on("shutdown", () => {
        writeLog("system shutdown");
        beginForcedSystemShutdown();
    });
    powerMonitor.on("lock-screen", () => {
        writeLog("system lock-screen");
        BrowserWindow.getAllWindows().forEach(item => {
            item.webContents.send("siyuan-send-windows", {cmd: "lockscreenByMode"});
        });
    });
});

app.on("open-url", async (event, url) => { // for macOS
    if (updateInstallPromise) {
        writeLog("ignored URL while installing update");
        return;
    }
    if (url.startsWith("siyuan://")) {
        if (remoteKernelTarget) {
            const mainWorkspace = workspaces[0];
            if (mainWorkspace?.browserWindow && !mainWorkspace.browserWindow.isDestroyed() &&
                initializedWindowIds.has(mainWorkspace.webContentsId)) {
                showWindow(mainWorkspace.browserWindow);
                mainWorkspace.browserWindow.webContents.send("siyuan-open-url", url);
            } else {
                pendingRemoteOpenURLs.push(url);
            }
            return;
        }
        let isBackground = true;
        if (workspaces.length === 0) {
            isBackground = false;
            let index = 0;
            while (index < 10) {
                index++;
                await sleep(500);
                if (workspaces.length > 0) {
                    break;
                }
            }
        }
        if (!isBackground) {
            await sleep(1500);
        }
        workspaces.forEach(item => {
            if (item.browserWindow && !item.browserWindow.isDestroyed()) {
                item.browserWindow.webContents.send("siyuan-open-url", url);
            }
        });
    }
});

app.on("second-instance", (event, argv) => {
    writeLog("second-instance [" + argv + "]");
    if (updateInstallPromise) {
        writeLog("ignored second instance while installing update");
        return;
    }
    if (remoteKernelArgError) {
        writeLog("ignored second instance because the primary remote kernel argument is invalid");
        return;
    }
    const secondRemoteArg = getArgFrom(argv, "--remote");
    if (secondRemoteArg !== undefined || remoteKernelTarget) {
        const siyuanURL = argv.find((arg) => arg.startsWith("siyuan://"));
        const localTargetRequested = getArgFrom(argv, "--workspace") !== undefined ||
            getArgFrom(argv, "--port") !== undefined;
        let secondRemoteOrigin;
        if (secondRemoteArg !== undefined) {
            try {
                secondRemoteOrigin = normalizeRemoteKernelOrigin(secondRemoteArg);
                writeLog("got second-instance remote kernel [origin=" + secondRemoteOrigin + "]");
                if (!remoteKernelTarget || secondRemoteOrigin !== remoteKernelTarget.origin) {
                    writeLog("ignored a different remote kernel while another SiYuan instance is running");
                }
            } catch (error) {
                writeLog("ignored invalid second-instance remote kernel: " + error.message);
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
        if (workspaces.length > 0) {
            const mainWindow = workspaces[0].browserWindow;
            showWindow(mainWindow);
            if (siyuanURL && allowDeepLink && initializedWindowIds.has(mainWindow.webContents.id)) {
                mainWindow.webContents.send("siyuan-open-url", siyuanURL);
            } else if (siyuanURL && allowDeepLink) {
                pendingRemoteOpenURLs.push(siyuanURL);
            }
        } else if (siyuanURL && allowDeepLink) {
            pendingRemoteOpenURLs.push(siyuanURL);
        }
        return;
    }
    let workspace = getArgFrom(argv, "--workspace");
    if (workspace) {
        writeLog("got second-instance arg [--workspace=" + workspace + "]");
    }
    let port = getArgFrom(argv, "--port");
    if (port) {
        writeLog("got second-instance arg [--port=" + port + "]");
    } else {
        port = 0;
    }
    let lang = getArgFrom(argv, "--lang");
    if (lang) {
        writeLog("got second-instance arg [--lang=" + lang + "]");
    } else {
        lang = "";
    }
    const foundWorkspace = workspaces.find(item => {
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
        initKernel(workspace, port, lang).then((startedKernelPort) => {
            if (startedKernelPort) {
                initMainWindow(startedKernelPort);
            }
        });
        return;
    }

    const siyuanURL = argv.find((arg) => arg.startsWith("siyuan://"));
    workspaces.forEach(item => {
        if (item.browserWindow && !item.browserWindow.isDestroyed() && siyuanURL) {
            item.browserWindow.webContents.send("siyuan-open-url", siyuanURL);
        }
    });

    if (!siyuanURL && 0 < workspaces.length) {
        showWindow(workspaces[0].browserWindow);
    }
});

app.on("activate", () => {
    if (updateInstallPromise || remoteKernelArgError) {
        return;
    }
    if (workspaces.length > 0) {
        const mainWindow = (latestActiveWindow && !latestActiveWindow.isDestroyed()) ? latestActiveWindow : workspaces[0].browserWindow;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
        }
    }
    if (BrowserWindow.getAllWindows().length === 0) {
        if (remoteKernelTarget) {
            initRemoteKernel(remoteKernelTarget).then((result) => {
                if (result) {
                    initMainWindow(result.target, result.authenticated);
                }
            }).catch((error) => writeLog("reactivate remote kernel failed: " + error));
        } else {
            initMainWindow();
        }
    }
});

app.on("web-contents-created", (webContentsCreatedEvent, contents) => {
    contents.setWindowOpenHandler((details) => {
        const kernelTarget = getWindowKernelTarget(contents.id);
        if (kernelTarget?.mode === "remote") {
            openExternalURL(details.url, true);
            return {action: "deny"};
        }
        // https://github.com/siyuan-note/siyuan/issues/10567
        if (details.url.startsWith("file:///") && details.disposition === "foreground-tab") {
            return;
        }
        // 在编辑器内打开链接的处理，比如 iframe 上的打开链接。
        shell.openExternal(details.url);
        return {action: "deny"};
    });
});

app.on("before-quit", (event) => {
    if (keepAppOpenDuringUpdate) {
        event.preventDefault();
        return;
    }
    workspaces.slice().forEach(item => {
        const pathname = getWindowPathname(item.browserWindow);
        if (!item.ownsKernel && (pathname !== "/stage/build/app/" ||
            !initializedWindowIds.has(item.webContentsId))) {
            const workspaceIndex = workspaces.indexOf(item);
            if (workspaceIndex > -1) {
                workspaces.splice(workspaceIndex, 1);
            }
            markExpectedRendererExit(item.browserWindow);
            item.browserWindow.destroy();
            return;
        }
        if (item.browserWindow && !item.browserWindow.isDestroyed()) {
            event.preventDefault();
            item.browserWindow.webContents.send("siyuan-save-close", true);
        }
    });
});

function writeLog(out) {
    console.log(out);
    const logFile = path.join(confDir, "app.log");
    let log = "";
    const maxLogLines = 1024;
    try {
        if (fs.existsSync(logFile)) {
            log = fs.readFileSync(logFile).toString();
            let lines = log.split("\n");
            if (maxLogLines < lines.length) {
                log = lines.slice(maxLogLines / 2, maxLogLines).join("\n") + "\n";
            }
        }
        out = out.toString();
        out = new Date().toISOString().replace(/T/, " ").replace(/\..+/, "") + " " + out;
        log += out + "\n";
        fs.writeFileSync(logFile, log);
    } catch (e) {
        console.error(e);
    }
}

// 同步记录工作空间主渲染进程崩溃标记，确保主进程退出前落盘。
const writeAppCrashMarker = (workspace, details) => {
    const timestamp = new Date().toISOString();
    const marker = {
        version: 1,
        timestamp: timestamp,
        reason: details.reason,
        exitCode: details.exitCode,
        workspaceDir: workspace.workspaceDir || "",
    };

    try {
        fs.writeFileSync(appCrashMarkerPath, JSON.stringify(marker, null, 2));
    } catch (e) {
        console.error(e);
    }

    try {
        const line = timestamp.replace(/T/, " ").replace(/\..+/, "") +
            " Render process gone [reason=" + details.reason + ", exitCode=" + details.exitCode +
            ", workspace=" + JSON.stringify(marker.workspaceDir) + "]";
        let log = "";
        if (fs.existsSync(appCrashLogPath)) {
            log = fs.readFileSync(appCrashLogPath, "utf8");
        }
        const lines = (log + line).trimEnd().split("\n").slice(-20);
        fs.writeFileSync(appCrashLogPath, lines.join("\n") + "\n");
    } catch (e) {
        console.error(e);
    }
};

const isDirectory = (filePath) => {
    if (!filePath) {
        return false;
    }

    try {
        return fs.statSync(filePath).isDirectory();
    } catch (e) {
        return false;
    }
};

// 优先读取结构化标记，并兼容旧版本的 app.crash.log。
const readAppCrashInfo = () => {
    if (fs.existsSync(appCrashMarkerPath)) {
        try {
            const markerText = fs.readFileSync(appCrashMarkerPath, "utf8");
            const marker = JSON.parse(markerText);
            if (noSafeModeReasons.has(marker.reason)) {
                fs.unlinkSync(appCrashMarkerPath);
            } else {
                let crashInfo = markerText;
                if (fs.existsSync(appCrashLogPath)) {
                    crashInfo = fs.readFileSync(appCrashLogPath, "utf8");
                }
                return {
                    workspaceDir: typeof marker.workspaceDir === "string" ? marker.workspaceDir : "",
                    crashInfo: crashInfo,
                };
            }
        } catch (e) {
            writeLog("read crash marker failed: " + e);
            try {
                return {
                    workspaceDir: "",
                    crashInfo: fs.readFileSync(appCrashMarkerPath, "utf8"),
                };
            } catch (readError) {
                writeLog("read invalid crash marker failed: " + readError);
                return {
                    workspaceDir: "",
                    crashInfo: "Invalid renderer crash marker",
                };
            }
        }
    }

    if (!fs.existsSync(appCrashLogPath)) {
        return undefined;
    }

    try {
        const crashInfo = fs.readFileSync(appCrashLogPath, "utf8");
        const legacyLines = crashInfo.split(/\r?\n/).filter((line) => line.trim());
        const reasons = legacyLines.map((line) => {
            const match = line.match(/reason=([^,\]]+)/);
            return match ? match[1] : undefined;
        });
        if (reasons.length > 0 && reasons.every((reason) => reason && noSafeModeReasons.has(reason))) {
            fs.unlinkSync(appCrashLogPath);
            writeLog("ignored legacy crash log without safe mode reason");
            return undefined;
        }
        return {
            workspaceDir: "",
            crashInfo: crashInfo,
        };
    } catch (e) {
        writeLog("read crash log failed: " + e);
        return {
            workspaceDir: "",
            crashInfo: "Unreadable renderer crash log",
        };
    }
};

// 安全模式选择后内核启动成功，删除本次恢复所使用的崩溃信息。
const clearAppCrashInfo = () => {
    [appCrashMarkerPath, appCrashLogPath].forEach((filePath) => {
        try {
            fs.unlinkSync(filePath);
        } catch (e) {
            // 文件不存在等异常忽略。
        }
    });
};
