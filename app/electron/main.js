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

const {
    net,
    app,
    BrowserWindow,
    Notification,
    shell,
    Menu,
    MenuItem,
    screen,
    ipcMain,
    globalShortcut,
    Tray,
    dialog,
    systemPreferences,
    powerMonitor
} = require("electron");
const path = require("path");
const fs = require("fs");
const gNet = require("net");
const remote = require("@electron/remote/main");

process.noAsar = true;
const appDir = path.dirname(app.getAppPath());
const isDevEnv = process.env.NODE_ENV === "development";
const appVer = app.getVersion();
const confDir = path.join(app.getPath("home"), ".config", "siyuan");
const windowStatePath = path.join(confDir, "windowState.json");
let bootWindow;
let latestActiveWindow;
let firstOpen = false;
let workspaces = []; // workspaceDir, id, browserWindow, tray, hideShortcut
let kernelPort = 6806;
let resetWindowStateOnRestart = false;

remote.initialize();

app.setPath("userData", app.getPath("userData") + "-Electron"); // `~/.config` 下 Electron 相关文件夹名称改为 `SiYuan-Electron` https://github.com/siyuan-note/siyuan/issues/3349
fs.rmSync(app.getPath("appData") + "/" + app.name, {recursive: true}); // 删除自动创建的应用目录 https://github.com/siyuan-note/siyuan/issues/13150

if (process.platform === "win32") {
    // Windows 需要设置 AppUserModelId 才能正确显示应用名称 https://github.com/siyuan-note/siyuan/issues/17022
    app.setAppUserModelId(app.name);
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
}

if (process.platform === "linux") {
    app.commandLine.appendSwitch("enable-wayland-ime");
    app.commandLine.appendSwitch("wayland-text-input-version", "3");
}

app.setAsDefaultProtocolClient("siyuan");

app.commandLine.appendSwitch("disable-web-security");
app.commandLine.appendSwitch("auto-detect", "false");
app.commandLine.appendSwitch("no-proxy-server");
app.commandLine.appendSwitch("enable-features", "PlatformHEVCDecoderSupport");
app.commandLine.appendSwitch("xdg-portal-required-version", "4");

// Support set Chromium command line arguments on the desktop https://github.com/siyuan-note/siyuan/issues/9696
writeLog("app is packaged [" + app.isPackaged + "], command line args [" + process.argv.join(", ") + "]");
let argStart = 1;
if (!app.isPackaged) {
    argStart = 2;
}

for (let i = argStart; i < process.argv.length; i++) {
    let arg = process.argv[i];
    if (arg.startsWith("--workspace=") || arg.startsWith("--openAsHidden") || arg.startsWith("--port=") || arg.startsWith("siyuan://")) {
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

const windowNavigate = (currentWindow, windowType) => {
    currentWindow.webContents.on("will-navigate", (event) => {
        const url = event.url;
        if (url.startsWith(localServer)) {
            try {
                const pathname = new URL(url).pathname;
                // 所有窗口都允许认证页面
                if (pathname === "/check-auth" || pathname === "/") {
                    return;
                }
                if (pathname === "/stage/build/app/" && windowType === "app") {
                    return;
                }
                if (pathname === "/stage/build/app/window.html" && windowType === "window") {
                    return;
                }
                if (pathname.startsWith("/export/temp/") && windowType === "export") {
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
        return "en_US";
    }

    const tag = languageTags[0].toLowerCase();
    const parts = tag.replace(/_/g, "-").split("-");
    const language = parts[0];

    if (language === "zh") {
        if (tag.includes("hant")) {
            return "zh_CHT";
        }
        if (tag.includes("hans") || tag.includes("cn") || tag.includes("sg")) {
            return "zh_CN";
        }
        if (tag.includes("tw") || tag.includes("hk") || tag.includes("mo")) {
            return "zh_CHT";
        }
        return "zh_CN";
    }

    const languageMapping = {
        "en": "en_US",
        "ar": "ar_SA",
        "de": "de_DE",
        "es": "es_ES",
        "fr": "fr_FR",
        "he": "he_IL",
        "it": "it_IT",
        "ja": "ja_JP",
        "ko": "ko_KR",
        "pl": "pl_PL",
        "pt": "pt_BR",
        "ru": "ru_RU",
        "sk": "sk_SK",
        "tr": "tr_TR"
    };

    return languageMapping[language] || "en_US";
};

const exitApp = (port, errorWindowId) => {
    let tray;
    let mainWindow;

    // 关闭端口相同的所有非主窗口
    BrowserWindow.getAllWindows().forEach((item) => {
        try {
            const currentURL = new URL(item.getURL());
            if (port.toString() === currentURL.port.toString()) {
                const hasMain = workspaces.find((workspaceItem) => {
                    if (workspaceItem.browserWindow.id === item.id) {
                        mainWindow = item;
                        return true;
                    }
                });
                if (!hasMain) {
                    item.destroy();
                }
            }
        } catch (e) {
            // load file is not a url
        }
    });
    workspaces.find((item, index) => {
        if (mainWindow && mainWindow.id === item.browserWindow.id) {
            if (workspaces.length > 1) {
                item.browserWindow.destroy();
            }
            workspaces.splice(index, 1);
            tray = item.tray;
            return true;
        }
    });
    if (tray && ("win32" === process.platform || "linux" === process.platform)) {
        tray.destroy();
    }
    if (workspaces.length === 0 && mainWindow) {
        try {
            if (resetWindowStateOnRestart) {
                fs.writeFileSync(windowStatePath, "{}");
            } else {
                const bounds = mainWindow.getBounds();
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
            BrowserWindow.getAllWindows().forEach((item) => {
                if (errorWindowId !== item.id) {
                    item.destroy();
                }
            });
        } else {
            app.exit();
        }
        globalShortcut.unregisterAll();
        writeLog("exited ui");
    }
};

const localServer = "http://127.0.0.1";

const getServer = (port = kernelPort) => {
    return localServer + ":" + port;
};

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

let openAsHidden = false;
const isOpenAsHidden = function () {
    return 1 === workspaces.length && openAsHidden;
};

const initMainWindow = () => {
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
        show: false,
        width: windowState.width,
        height: windowState.height,
        minWidth: 493,
        minHeight: 376,
        fullscreenable: true,
        fullscreen: windowState.fullscreen,
        trafficLightPosition: {x: 8, y: 8},
        transparent: "darwin" === process.platform, // 避免缩放窗口时出现边框
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

    // set proxy
    net.fetch(getServer() + "/api/system/getNetwork", {method: "POST"}).then((response) => {
        return response.json();
    }).then((response) => {
        setProxy(`${response.data.proxy.scheme}://${response.data.proxy.host}:${response.data.proxy.port}`, currentWindow.webContents).then(() => {
            // 加载主界面
            currentWindow.loadURL(getServer() + "/stage/build/app/?v=" + new Date().getTime());
        });
    });

    // 发起互联网服务请求时绕过安全策略 https://github.com/siyuan-note/siyuan/issues/5516
    currentWindow.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
        if (-1 < details.url.toLowerCase().indexOf("bili")) {
            // B 站不移除 Referer https://github.com/siyuan-note/siyuan/issues/94
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

    // 主界面事件监听
    currentWindow.once("ready-to-show", () => {
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

const initKernel = (workspace, port, lang) => {
    return new Promise(async (resolve) => {
        bootWindow = new BrowserWindow({
            show: false,
            width: Math.floor(screen.getPrimaryDisplay().size.width / 2),
            height: Math.floor(screen.getPrimaryDisplay().workAreaSize.height / 2),
            frame: false,
            backgroundColor: "#1e1e1e",
            resizable: false,
            icon: path.join(appDir, "stage", "icon-large.png"),
        });
        let bootIndex = path.join(appDir, "app", "electron", "boot.html");
        if (isDevEnv) {
            bootIndex = path.join(appDir, "electron", "boot.html");
        }
        bootWindow.loadFile(bootIndex, {query: {v: appVer}});
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
        const cmds = ["--port", kernelPort, "--wd", appDir];
        if (isDevEnv && workspaces.length === 0) {
            cmds.push("--mode", "dev");
        }
        if (workspace && "" !== workspace) {
            cmds.push("--workspace", workspace);
        }
        if (port && "" !== port) {
            cmds.push("--port", port);
        }
        if (lang && "" !== lang) {
            cmds.push("--lang", lang);
        }
        let cmd = `ui version [${appVer}], booting kernel [${kernelPath} ${cmds.join(" ")}]`;
        writeLog(cmd);
        if (!isDevEnv || workspaces.length > 0) {
            const cp = require("child_process");
            const kernelProcess = cp.spawn(kernelPath, cmds, {
                detached: false, // 桌面端内核进程不再以游离模式拉起 https://github.com/siyuan-note/siyuan/issues/6336
                stdio: "ignore",
            },);

            const currentKernelPort = kernelPort;
            writeLog("booted kernel process [pid=" + kernelProcess.pid + ", port=" + kernelPort + "]");
            kernelProcess.on("close", (code) => {
                writeLog(`kernel [pid=${kernelProcess.pid}, port=${currentKernelPort}] exited with code [${code}]`);
                if (0 !== code) {
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
                const apiResult = await net.fetch(getServer() + "/api/system/version");
                apiData = await apiResult.json();
                bootWindow.loadURL(getServer() + "/appearance/boot/index.html");
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
                net.fetch(getServer() + "/api/system/exit", {method: "POST"});
                bootWindow.destroy();
                resolve(false);
            } else {
                let progressing = false;
                while (!progressing) {
                    try {
                        const progressResult = await net.fetch(getServer() + "/api/system/bootProgress");
                        const progressData = await progressResult.json();
                        if (progressData.data.progress >= 100) {
                            resolve(true);
                            progressing = true;
                        } else {
                            await sleep(100);
                        }
                    } catch (e) {
                        writeLog("get boot progress failed: " + e.message);
                        net.fetch(getServer() + "/api/system/exit", {method: "POST"});
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
        if (data.cmd === "showOpenDialog") {
            return dialog.showOpenDialog(data);
        }
        if (data.cmd === "getContentsId") {
            return event.sender.id;
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
            case "notification":
                new Notification({
                    title: data.title,
                    body: data.body,
                    icon: path.join(appDir, "stage", "icon.png"),
                }).show();
                break;
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
            show: true,
            trafficLightPosition: {x: 8, y: 13},
            width: Math.floor(data.width || mainScreen.size.width * 0.7),
            height: Math.floor(data.height || mainScreen.size.height * 0.9),
            minWidth: 493,
            minHeight: 376,
            fullscreenable: true,
            transparent: "darwin" === process.platform, // 避免缩放窗口时出现边框
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
        const foundWorkspace = workspaces.find((item) => {
            if (item.workspaceDir === data.workspace) {
                showWindow(item.browserWindow);
                return true;
            }
        });
        if (!foundWorkspace) {
            initKernel(data.workspace, "", "").then((isSucc) => {
                if (isSucc) {
                    initMainWindow();
                }
            });
        }
    });
    ipcMain.handle("siyuan-init", async (event, data) => {
        const exitWS = workspaces.find(item => {
            if (event.sender.id === item.browserWindow.webContents.id && item.workspaceDir) {
                if (item.tray && "win32" === process.platform || "linux" === process.platform) {
                    // Tray menu text does not change with the appearance language https://github.com/siyuan-note/siyuan/issues/7935
                    resetTrayMenu(item.tray, data.languages, item.browserWindow);
                }
                return true;
            }
        });
        if (exitWS) {
            return;
        }

        workspaces.find(item => {
            if (!item.workspaceDir) {
                item.workspaceDir = data.workspaceDir;
                let tray;
                if ("win32" === process.platform || "linux" === process.platform) {
                    // 系统托盘
                    tray = new Tray(path.join(appDir, "stage", "icon-large.png"));
                    tray.setToolTip(`${path.basename(data.workspaceDir)} - SiYuan v${appVer}`);
                    const mainWindow = getWindowByContentId(event.sender.id);
                    if (!mainWindow || mainWindow.isDestroyed()) {
                        return;
                    }
                    resetTrayMenu(tray, data.languages, mainWindow);
                    tray.on("click", () => {
                        showHideWindow(tray, data.languages, mainWindow);
                    });
                }
                item.tray = tray;
                return true;
            }
        });
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
            initKernel(data.workspace, "", data.lang).then((isSucc) => {
                if (isSucc) {
                    initMainWindow();
                }
            });
            firstOpenWindow.destroy();
        });
    } else {
        const getArg = (name) => {
            for (let i = 0; i < process.argv.length; i++) {
                if (process.argv[i].startsWith(name)) {
                    return process.argv[i].split("=")[1];
                }
            }
        };

        const workspace = getArg("--workspace");
        if (workspace) {
            writeLog("got arg [--workspace=" + workspace + "]");
        }
        const port = getArg("--port");
        if (port) {
            writeLog("got arg [--port=" + port + "]");
        }
        initKernel(workspace, port, "").then((isSucc) => {
            if (isSucc) {
                initMainWindow();
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
        workspaces.forEach(item => {
            const currentURL = new URL(item.browserWindow.getURL());
            net.fetch(getServer(currentURL.port) + "/api/system/exit", {method: "POST"});
        });
    });
    powerMonitor.on("lock-screen", () => {
        writeLog("system lock-screen");
        BrowserWindow.getAllWindows().forEach(item => {
            item.webContents.send("siyuan-send-windows", {cmd: "lockscreenByMode"});
        });
    });
});

app.on("open-url", async (event, url) => { // for macOS
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
        initKernel(workspace, port, "").then((isSucc) => {
            if (isSucc) {
                initMainWindow();
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
