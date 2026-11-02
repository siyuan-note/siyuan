// 启动页窗口：端口分配、窗口创建与加载、以及 app 就绪时的提前准备。
import {join} from "node:path";
import {createServer} from "node:net";
import {app, BrowserWindow, screen} from "electron";
import {getArg, paths, state, writeLog} from "../shared/runtime";
import {resolveAppLanguage} from "../shared/language";
import {errorMessage} from "../shared/errors";
import {appIconPath} from "../shared/desktopDefaults";
import {addBootWindow, getCurrentBootWindow, removeBootWindow, setCurrentBootWindow} from "./windowRegistry";
import type {BootWindow, LoadBootWindow, PreparedBoot} from "../shared/types";

const loadBootWindow: LoadBootWindow = ({
    disableAppearance = false,
    window: currentBootWindow = getCurrentBootWindow(),
    port = state.kernel.port,
    lang = getArg("--lang"),
} = {}): void => {
    if (!currentBootWindow || currentBootWindow.isDestroyed()) {
        return;
    }
    if (disableAppearance) {
        currentBootWindow.appearanceFallback = true;
    }
    const query: Record<string, string> = {
        v: paths.appVer,
        port: port as string,
        lang: lang || resolveAppLanguage(app.getPreferredSystemLanguages()),
    };
    currentBootWindow.kernelPort = port;
    currentBootWindow.lang = lang;
    if (currentBootWindow.previousExitWaiting) {
        query.previousExitWaiting = currentBootWindow.previousExitWaiting;
    }
    const remoteKernelTarget = state.startup.remoteKernelTarget;
    if (remoteKernelTarget) {
        query.remote = remoteKernelTarget.origin;
        query.appearance = "0";
    }
    if (currentBootWindow.appearanceFallback) {
        query.appearance = "0";
    }
    currentBootWindow.loadFile(join(paths.assetsDir, "boot.html"), {query}).catch((error: Error) => {
        writeLog("load boot window failed: " + error);
    });
};

const createBootWindow = (): BootWindow => {
    const created = new BrowserWindow({
        show: false,
        width: Math.floor(screen.getPrimaryDisplay().size.width / 2),
        height: Math.floor(screen.getPrimaryDisplay().workAreaSize.height / 2),
        frame: false,
        backgroundColor: "#1e1e1e",
        resizable: false,
        icon: appIconPath(),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
        },
    }) as BootWindow;
    const currentBootWindow = created;
    setCurrentBootWindow(currentBootWindow);
    addBootWindow(currentBootWindow);
    currentBootWindow.once("closed", () => removeBootWindow(currentBootWindow));
    currentBootWindow.on("unresponsive", () => {
        if (!currentBootWindow.appearanceFallback) {
            writeLog("boot window is unresponsive, reload without custom appearance");
            loadBootWindow({disableAppearance: true, window: currentBootWindow,
                port: currentBootWindow.kernelPort, lang: currentBootWindow.lang});
        }
    });
    return currentBootWindow;
};

const getAvailablePort = (port?: string | number,
    useDevKernel = paths.isDevEnv && state.workspaces.length === 0): Promise<string | number> => {
    if (useDevKernel) {
        return Promise.resolve(state.kernel.port);
    }
    if (port) {
        state.kernel.port = port;
        return Promise.resolve(state.kernel.port);
    }
    return new Promise<string | number>((resolve) => {
        const server = createServer();
        server.on("error", error => {
            writeLog(errorMessage(error));
            state.kernel.port = "";
            resolve("");
        });
        server.listen(0, () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                writeLog("local port allocation returned no address");
                state.kernel.port = "";
                server.close(() => resolve(""));
                return;
            }
            const availablePort = address.port;
            state.kernel.port = availablePort;
            server.close(() => resolve(availablePort));
        });
    });
};

const showLocalBootWindow = (currentBootWindow: BootWindow = getCurrentBootWindow() as BootWindow,
    port: string | number = state.kernel.port, lang?: string): void => {
    const bootWindowCreatedAt = Date.now();
    if (!state.startup.openAsHidden) {
        if ("win32" === process.platform) {
            currentBootWindow.setOpacity(0);
        }
        currentBootWindow.once("ready-to-show", () => {
            if (!currentBootWindow.isDestroyed()) {
                currentBootWindow.show();
                writeLog("boot window ready to show [" + (Date.now() - bootWindowCreatedAt) + "ms since load]");
                if ("win32" === process.platform) {
                    setImmediate(() => {
                        if (!currentBootWindow.isDestroyed()) {
                            currentBootWindow.setOpacity(1);
                        }
                    });
                }
            }
        });
    }
    loadBootWindow({window: currentBootWindow, port, lang});
    if (state.startup.openAsHidden) {
        currentBootWindow.minimize();
    }
};

const prepareLocalKernelBoot = (): PreparedBoot => {
    createBootWindow();
    const currentBootWindow = getCurrentBootWindow() as BootWindow;
    return {
        window: currentBootWindow,
        ready: getAvailablePort(getArg("--port")).then((port) => {
            if (port && !currentBootWindow.isDestroyed()) {
                showLocalBootWindow(currentBootWindow, port, getArg("--lang"));
            }
            return port;
        }),
    };
};

export {
    loadBootWindow,
    createBootWindow,
    getCurrentBootWindow as getBootWindow,
    getAvailablePort,
    showLocalBootWindow,
    prepareLocalKernelBoot,
};
