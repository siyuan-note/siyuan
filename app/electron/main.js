// SiYuan - Refactor your thinking
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
const gNet = require("net");
const childProcess = require("child_process");
const remote = require("@electron/remote/main");

process.noAsar = true;
const appDir = path.dirname(app.getAppPath());
const isDevEnv = process.env.NODE_ENV === "development";
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
let latestActiveWindow;
let firstOpen = false;
let workspaces = []; // workspaceDir, id, port, webContentsId, browserWindow, tray, hideShortcut
let kernelPort = 6806;
let resetWindowStateOnRestart = false;
let openAsHidden = false;
let systemShutdownState = systemShutdownNone;
let gracefulSystemShutdownPromise;
let keepAppOpenDuringSystemShutdown = false;
let updateInstallPromise;
let keepAppOpenDuringUpdate = false;
const openDialogSingletons = new Set();
const isOpenAsHidden = function () {
    return 1 === workspaces.length && openAsHidden;
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

app.commandLine.appendSwitch("disable-web-security");
app.commandLine.appendSwitch("auto-detect", "false");
app.commandLine.appendSwitch("no-proxy-server");
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
    if (arg.startsWith("--workspace=") || arg.startsWith("--openAsHidden") || arg.startsWith("--port=") || arg.startsWith("--safe-mode=") || arg.startsWith("--lang=") || arg.startsWith("siyuan://")) {
        // 跳过内置参数
        if (arg.startsWith("--openAsHidden")) {
            openAsHidden = true;
            writeLog("open as hidden");
        }
        continue;
    }

    app.commandLine.appendSwitch(arg);
    writeLog("command line switch [" + arg + "]");
}

try {
    firstOpen = !fs.existsSync(path.join(confDir, "workspace.json"));
    if (!fs.existsSync(confDir)) {
        fs.mkdirSync(confDir, {mode: 0o755, recursive: true});
    }
} catch (e) {
    console.error(e);
    require("electron").dialog.showErrorBox("创建配置目录失败 Failed to create config directory", "思源需要在用户家目录下创建配置文件夹（~/.config/siyuan），请确保该路径具有写入权限。\n\nSiYuan needs to create a configuration folder (~/.config/siyuan) in the user's home directory. Please make sure that the path has write permissions.");
    app.exit();
}

// 解析命令行参数，参数需以 `name=value` 形式传入 https://github.com/siyuan-note/siyuan/issues/14748
const getArg = (name) => {
    for (let i = 0; i < process.argv.length; i++) {
        if (process.argv[i].startsWith(name)) {
            return process.argv[i].split("=")[1];
        }
    }
};

// 检测上次打开的工作空间是否丢失 https://github.com/siyuan-note/siyuan/issues/14748
let lastWorkspaceMissing = false;
let missingWorkspacePath = "";
let availableWorkspaces = [];
if (!firstOpen && !getArg("--workspace")) {
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
if (!firstOpen && !getArg("--workspace")) {
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

const windowNavigate = (currentWindow, windowType) => {
    currentWindow.webContents.on("will-navigate", (event) => {
        const url = event.url;
        if (url.startsWith(localServer)) {
            try {
                const pathname = new URL(url).pathname;
                if (windowType === "app" && ["/", "/stage/build/app/", "/check-auth"].includes(pathname) ||
                    (windowType === "window" && ["/stage/build/app/window.html", "/check-auth"].includes(pathname)) ||
                    (windowType === "export" && pathname.startsWith("/export/temp/"))) {
                    return;
                }
            } catch (e) {
                return;
            }
        }
        // 其他链接使用浏览器打开
        event.preventDefault();
        shell.openExternal(url);
    });
};

const setProxy = (proxyURL, webContents) => {
    if (proxyURL.startsWith("://")) {
        console.log("network proxy [system]");
        return webContents.session.setProxy({mode: "system"});
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

const markExpectedRendererExit = (window) => {
    if (window && !window.isDestroyed()) {
        expectedRendererExitIds.add(window.webContents.id);
    }
};

const exitApp = (port, errorWindowId) => {
    const workspaceIndex = workspaces.findIndex((item) => port.toString() === item.port.toString());
    const workspace = -1 < workspaceIndex ? workspaces[workspaceIndex] : undefined;
    const mainWindow = workspace ? workspace.browserWindow : undefined;
    const tray = workspace ? workspace.tray : undefined;

    // 关闭端口相同的所有非主窗口
    BrowserWindow.getAllWindows().forEach((item) => {
        try {
            const currentURL = new URL(item.getURL());
            if (port.toString() === currentURL.port.toString()) {
                if (!mainWindow || mainWindow.id !== item.id) {
                    item.destroy();
                }
            }
        } catch (e) {
            // load file is not a url
        }
    });
    if (workspace) {
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

const localServer = "https://127.0.0.1";

const getServer = (port = kernelPort) => {
    return localServer + ":" + port;
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
    if (!workspace || !workspace.workspaceDir || !data || !data.port ||
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
        if (workspaceItem.port) {
            ports.add(workspaceItem.port);
        }
    });
    if (bootWindow && !bootWindow.isDestroyed() && kernelPort) {
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

const showErrorWindow = (titleZh, titleEn, content, emoji = "⚠️") => {
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
            icon: path.join(appDir, "stage", "icon-large.png"),
        },
    });
    errWindow.show();
    return errWindow.id;
};

const initMainWindow = (currentKernelPort = kernelPort) => {
    if (!app.isReady()) {
        writeLog("initMainWindow: app not ready, skipping");
        return;
    }

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
            webviewTag: true,
            webSecurity: false,
            contextIsolation: false,
            autoplayPolicy: "user-gesture-required" // 桌面端禁止自动播放多媒体 https://github.com/siyuan-note/siyuan/issues/7587
        },
        frame: "darwin" === process.platform,
        titleBarStyle: "hidden",
        icon: path.join(appDir, "stage", "icon-large.png"),
    });
    remote.enable(currentWindow.webContents);

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
        currentWindow.loadURL(getServer(currentKernelPort) + "/stage/build/app/?v=" + Date.now());
    };
    net.fetch(getServer(currentKernelPort) + "/api/system/getNetwork", {method: "POST"}).then((response) => {
        return response.json();
    }).then((response) => {
        const setProxyDone = setProxy(`${response.data.proxy.scheme}://${response.data.proxy.host}:${response.data.proxy.port}`, currentWindow.webContents);
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
        for (let key in details.responseHeaders) {
            if ("x-frame-options" === key.toLowerCase()) {
                delete details.responseHeaders[key];
            } else if ("content-security-policy" === key.toLowerCase()) {
                delete details.responseHeaders[key];
            } else if ("access-control-allow-origin" === key.toLowerCase()) {
                delete details.responseHeaders[key];
            }
        }
        cb({responseHeaders: details.responseHeaders});
    });

    currentWindow.webContents.on("did-finish-load", () => {
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

    if (windowState.isDevToolsOpened) {
        currentWindow.webContents.openDevTools({mode: "bottom"});
    }

    // 菜单
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
        role: "editMenu", submenu: [{role: "cut"}, {role: "copy"}, {role: "paste"}, {
            role: "pasteAndMatchStyle", accelerator: "CmdOrCtrl+Shift+C"
        }, {role: "selectAll"},],
    }, {
        role: "windowMenu",
        submenu: [{role: "minimize"}, {role: "zoom"}, {role: "togglefullscreen"}, {type: "separator"}, {role: "toggledevtools"}, {type: "separator"}, {role: "front"},],
    },];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    // 当前页面链接使用浏览器打开
    windowNavigate(currentWindow, "app");
    currentWindow.on("close", (event) => {
        if (currentWindow && !currentWindow.isDestroyed()) {
            currentWindow.webContents.send("siyuan-save-close", false);
        }
        event.preventDefault();
    });
    workspaces.push({
        browserWindow: currentWindow,
        webContentsId: currentWindow.webContents.id,
        port: currentKernelPort,
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

const initKernel = (workspace, port, lang, safeMode) => {
    return new Promise(async (resolve) => {
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
        let bootIndex = path.join(appDir, "app", "electron", "boot.html");
        if (isDevEnv) {
            bootIndex = path.join(appDir, "electron", "boot.html");
        }
        bootWindow.loadFile(bootIndex, {query: {v: appVer, port: kernelPort}});
        if (openAsHidden) {
            bootWindow.minimize();
        } else {
            bootWindow.show();
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
                            errorWindowId = showErrorWindow("数据库不可用", "The database is unavailable", "<div>无法访问数据库文件，请查看 工作空间/temp/siyuan.log 获取详细报错信息</div><div>Cannot access the database file. Please check workspace/temp/siyuan.log for detailed error information.</div>");
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
                            errorWindowId = showErrorWindow("初始化工作空间失败", "Failed to create workspace directory", "<div>工作空间文件夹权限不足，请查看 工作空间/temp/siyuan.log 获取详细报错信息</div><div>Insufficient permissions for the workspace folder. Please check workspace/temp/siyuan.log for detailed error information.</div>");
                            break;
                        case 26:
                            errorWindowId = showErrorWindow("已成功避免潜在的数据损坏", "Successfully avoid potential data corruption", "<div>工作空间下的文件正在被第三方软件（比如同步网盘、杀毒软件等）打开占用，继续使用会导致数据损坏，思源内核已经安全退出。</div><div>请将工作空间移动到其他路径后再打开，停止同步盘同步工作空间，并将工作空间加入杀毒软件信任列表。如果以上步骤无法解决问题，请参考<a href=\"https://ld246.com/article/1684586140917\" target=\"_blank\">这里</a>或者<a href=\"https://ld246.com/article/1649901726096\" target=\"_blank\">发帖</a>寻求帮助。</div><div>The files in the workspace are being opened and occupied by third-party software (such as synchronized network disk, antivirus software, etc.), continuing to use it will cause data corruption, and the SiYuan Kernel is already safe shutdown.</div><div>Move the workspace to another path and open it again, stop the network disk to sync the workspace, and add the workspace to the antivirus software trust list. If the above steps do not resolve the issue, please look for help or report bugs <a href=\"https://liuyun.io/article/1686530886208\" target=\"_blank\">here</a>.</div>", "🚒");
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
                            "<div>内核启动超时，请查看 工作空间/temp/siyuan.log 获取详细报错信息，或尝试重启思源。</div>" +
                            "<div>Kernel boot timed out. Please check workspace/temp/siyuan.log for details, or try restarting SiYuan.</div>");
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

app.whenReady().then(() => {
    // Trust self-signed TLS certificates for local HTTPS server
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
        if (request.hostname === "127.0.0.1" || request.hostname === "localhost") {
            callback(0); // VERIFY_OK
        } else {
            callback(-3); // default Chromium handling
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
    const hideWindow = (wnd) => {
        // 通过 `Alt+M` 最小化后焦点回到先前的窗口 https://github.com/siyuan-note/siyuan/issues/7275
        wnd.minimize();
        // Mac 隐藏后无法再 Dock 中显示
        if ("win32" === process.platform || "linux" === process.platform) {
            wnd.hide();
        }
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

    const getWindowByContentId = (id) => {
        return BrowserWindow.getAllWindows().find((win) => win.webContents.id === id);
    };
    ipcMain.on("siyuan-context-menu", (event, langs) => {
        const template = [new MenuItem({
            role: "undo", label: langs.undo
        }), new MenuItem({
            role: "redo", label: langs.redo
        }), {type: "separator"}, new MenuItem({
            role: "copy", label: langs.copy
        }), new MenuItem({
            role: "cut", label: langs.cut
        }), new MenuItem({
            role: "delete", label: langs.delete
        }), new MenuItem({
            role: "paste", label: langs.paste
        }), new MenuItem({
            role: "pasteAndMatchStyle", label: langs.pasteAsPlainText
        }), new MenuItem({
            role: "selectAll", label: langs.selectAll
        })];
        const menu = Menu.buildFromTemplate(template);
        menu.popup({window: BrowserWindow.fromWebContents(event.sender)});
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
        if (data.cmd === "clipboardRead") {
            return clipboard.read(data.format);
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
            return setProxy(data.proxyURL, event.sender);
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
            let hasMatch = false;
            BrowserWindow.getAllWindows().find(item => {
                const url = new URL(item.webContents.getURL());
                if (item.webContents.id === event.sender.id || data.port !== url.port) {
                    return;
                }
                const ids = decodeURIComponent(url.hash.substring(1)).split("\u200b");
                const options = JSON.parse(data.options);
                if (ids.includes(options.rootID) || ids.includes(options.assetPath)) {
                    item.focus();
                    item.webContents.send("siyuan-open-file", options);
                    hasMatch = true;
                    return true;
                }
            });
            return hasMatch;
        }
    });

    const initEventId = [];
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
        currentWindow.on("focus", () => {
            event.sender.send("siyuan-event", "focus");
            latestActiveWindow = currentWindow;
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
        switch (cmd) {
            case "showItemInFolder":
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
                shell.openPath(data.filePath);
                break;
            case "openDevTools":
                event.sender.openDevTools({mode: "bottom"});
                break;
            case "unregisterGlobalShortcut":
                if (data.accelerator) {
                    globalShortcut.unregister(hotKey2Electron(data.accelerator));
                }
                break;
            case "registerGlobalShortcut":
                if (data.accelerator) {
                    globalShortcut.unregister(hotKey2Electron(data.accelerator));
                    globalShortcut.register(hotKey2Electron(data.accelerator), () => {
                        BrowserWindow.getAllWindows().forEach(itemB => {
                            itemB.webContents.send("siyuan-hotkey", {
                                hotkey: data.accelerator
                            });
                        });
                    });
                }
                break;
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
        dialog.showOpenDialog({
            title: data.title, properties: ["createDirectory", "openDirectory"],
        }).then((result) => {
            if (result.canceled) {
                event.sender.destroy();
                return;
            }
            data.filePaths = result.filePaths;
            data.webContentsId = event.sender.id;
            getWindowByContentId(data.parentWindowId).send("siyuan-export-pdf", data);
        });
    });
    ipcMain.on("siyuan-export-newwindow", (event, data) => {
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
        printWin.webContents.userAgent = "SiYuan/" + appVer + " https://b3log.org/siyuan Electron " + printWin.webContents.userAgent;
        printWin.loadURL(data);
        windowNavigate(printWin, "export");
    });
    ipcMain.on("siyuan-quit", (event, port) => {
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
                webviewTag: true,
                webSecurity: false,
                autoplayPolicy: "user-gesture-required" // 桌面端禁止自动播放多媒体 https://github.com/siyuan-note/siyuan/issues/7587
            },
        });
        remote.enable(win.webContents);

        if (data.position) {
            win.setPosition(data.position.x, data.position.y);
        } else {
            win.center();
        }
        win.setAlwaysOnTop(data.alwaysOnTop);
        win.webContents.userAgent = "SiYuan/" + appVer + " https://b3log.org/siyuan Electron " + win.webContents.userAgent;
        win.webContents.session.setSpellCheckerLanguages(["en-US"]);
        win.loadURL(data.url);
        windowNavigate(win, "window");
        win.on("close", (event) => {
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
        const exitWS = workspaces.find(item => {
            if (event.sender.id === item.webContentsId && item.workspaceDir) {
                if (item.tray && ("win32" === process.platform || "linux" === process.platform)) {
                    // Tray menu text does not change with the appearance language https://github.com/siyuan-note/siyuan/issues/7935
                    resetTrayMenu(item.tray, data.languages, item.browserWindow);
                }
                return true;
            }
        });
        if (exitWS) {
            return;
        }

        const workspaceItem = workspaces.find((item) => event.sender.id === item.webContentsId);
        if (workspaceItem) {
            workspaceItem.workspaceDir = data.workspaceDir;
            let tray;
            if ("win32" === process.platform || "linux" === process.platform) {
                // 系统托盘
                tray = new Tray(path.join(appDir, "stage", "icon-large.png"));
                tray.setToolTip(`${path.basename(data.workspaceDir)} - SiYuan v${appVer}`);
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
        await net.fetch(getServer(data.port) + "/api/system/uiproc?pid=" + process.pid, {method: "POST"});
    });
    ipcMain.on("siyuan-hotkey", (event, data) => {
        if (!data.hotkeys || data.hotkeys.length === 0) {
            return;
        }
        workspaces.find(workspaceItem => {
            if (event.sender.id === workspaceItem.browserWindow.webContents.id) {
                workspaceItem.hotkeys = data.hotkeys;
                return true;
            }
        });
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
                    if (mainWindow.isMinimized()) {
                        mainWindow.restore();
                        mainWindow.show(); // 按 `Alt+M` 后隐藏窗口，再次按 `Alt+M` 显示窗口后会卡住不能编辑 https://github.com/siyuan-note/siyuan/issues/8456
                    } else {
                        if (mainWindow.isVisible()) {
                            if (!mainWindow.isFocused()) {
                                mainWindow.show();
                            } else {
                                hideWindow(mainWindow);
                            }
                        } else {
                            mainWindow.show();
                        }
                    }
                    if ("win32" === process.platform || "linux" === process.platform) {
                        resetTrayMenu(currentWorkspace.tray, data.languages, mainWindow);
                    }
                });
            } else {
                globalShortcut.register(shortcut, () => {
                    BrowserWindow.getAllWindows().forEach(itemB => {
                        itemB.webContents.send("siyuan-hotkey", {
                            hotkey: item
                        });
                    });
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
        app.setLoginItemSettings({
            openAtLogin: data.openAtLogin,
            args: data.openAsHidden ? ["--openAsHidden"] : ""
        });
    });
    const appCrashInfo = readAppCrashInfo();
    if (firstOpen) {
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
            const currentURL = new URL(item.browserWindow.getURL());
            const server = getServer(currentURL.port);
            writeLog("sync after system resume [" + server + "/api/sync/performSync" + "]");
            net.fetch(server + "/api/sync/performSync", {method: "POST"});
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
    let workspace = argv.find((arg) => arg.startsWith("--workspace="));
    if (workspace) {
        workspace = workspace.split("=")[1];
        writeLog("got second-instance arg [--workspace=" + workspace + "]");
    }
    let port = argv.find((arg) => arg.startsWith("--port="));
    if (port) {
        port = port.split("=")[1];
        writeLog("got second-instance arg [--port=" + port + "]");
    } else {
        port = 0;
    }
    let lang = argv.find((arg) => arg.startsWith("--lang="));
    if (lang) {
        lang = lang.split("=")[1];
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
    if (updateInstallPromise) {
        return;
    }
    if (workspaces.length > 0) {
        const mainWindow = (latestActiveWindow && !latestActiveWindow.isDestroyed()) ? latestActiveWindow : workspaces[0].browserWindow;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
        }
    }
    if (BrowserWindow.getAllWindows().length === 0) {
        initMainWindow();
    }
});

app.on("web-contents-created", (webContentsCreatedEvent, contents) => {
    contents.setWindowOpenHandler((details) => {
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
    workspaces.forEach(item => {
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
