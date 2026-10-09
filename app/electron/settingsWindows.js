const {normalizeWindowGeometry, captureWindowGeometry} = require("./windowGeometry");

const settingsPath = "/stage/build/app/settings.html";

// 只允许已登记的内核页面打开预先授权的设置页，不改变普通链接的打开规则。
const createSettingsWindows = ({ipcMain, screen, getTarget, initialize, show, log, icon, platform = process.platform}) => {
    const pending = new Map();
    const reservations = new Map();
    const windows = new Map();
    const windowStates = new WeakMap();
    const owners = new WeakMap();
    const release = approved => {
        clearTimeout(approved.timer);
        const key = approved.owner.id + ":" + approved.frameName;
        if (pending.get(key) === approved) pending.delete(key);
        if (reservations.get(approved.key) === approved) reservations.delete(approved.key);
    };
    const finish = (approved, ownerInvalidated = false) => {
        if (!approved.active) return;
        approved.active = false;
        release(approved);
        owners.get(approved.owner).records.delete(approved);
        if (windows.get(approved.key) === approved.win) windows.delete(approved.key);
        if (!approved.owner.isDestroyed()) {
            try {
                approved.owner.send("siyuan-settings-closed", approved.data.token, ownerInvalidated);
            } catch (error) {
                log("settings owner failed to receive close notification: " + error);
            }
        }
    };
    const cancel = (approved, ownerInvalidated = false) => {
        finish(approved, ownerInvalidated);
        if (approved.win && !approved.win.isDestroyed()) approved.win.destroy();
    };
    const watchOwner = owner => {
        let state = owners.get(owner);
        if (state) return state;
        state = {records: new Set()};
        owners.set(owner, state);
        const invalidate = () => {
            for (const approved of [...state.records]) cancel(approved, true);
        };
        owner.on("did-start-navigation", details => {
            if (details.isMainFrame && !details.isSameDocument) invalidate();
        });
        owner.on("render-process-gone", invalidate);
        owner.once("destroyed", invalidate);
        owner.on("did-create-window", (win, details) => {
            const approved = [...state.records].find(item => item.url === details.url && item.created);
            if (approved) {
                approved.created(win);
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
    ipcMain.on("siyuan-settings-ready", event => {
        if (event.senderFrame !== event.sender.mainFrame) return;
        for (const win of windows.values()) {
            if (!win.isDestroyed() && win.webContents === event.sender) {
                const state = windowStates.get(win);
                state.ready = true;
                state.reveal();
                return;
            }
        }
    });
    ipcMain.on("siyuan-settings-close-self", event => {
        if (event.senderFrame !== event.sender.mainFrame) return;
        for (const win of windows.values()) {
            if (!win.isDestroyed() && win.webContents === event.sender) {
                cancel(windowStates.get(win).approved);
                return;
            }
        }
    });
    ipcMain.on("siyuan-settings-close", (event, data) => {
        const target = getTarget(event.sender.id);
        if (!target || event.senderFrame !== event.sender.mainFrame || !data ||
            !/^(builtin|plugin-[a-zA-Z0-9-]+)$/.test(data.key) ||
            !/^[a-zA-Z0-9-]{1,100}$/.test(data.token)) return;
        const registryKey = `${target.origin}:${data.key === "builtin" ? "builtin" : event.sender.id + ":" + data.key}`;
        const reserved = reservations.get(registryKey);
        if (reserved && reserved.owner === event.sender && reserved.data.token === data.token) cancel(reserved);
        const win = windows.get(registryKey);
        const approved = win && windowStates.get(win).approved;
        if (approved?.owner === event.sender && approved.data.token === data.token) cancel(approved);
    });
    ipcMain.handle("siyuan-settings-prepare", (event, data) => {
        const requestedAt = Date.now();
        const target = getTarget(event.sender.id);
        if (!target || event.senderFrame !== event.sender.mainFrame || !data ||
            !/^[a-zA-Z0-9-]{1,100}$/.test(data.token) ||
            !/^(builtin|plugin-[a-zA-Z0-9-]+)$/.test(data.key)) {
            return {create: false};
        }
        let ownerURL;
        try {
            ownerURL = new URL(event.sender.getURL());
        } catch {
            return {create: false};
        }
        if (ownerURL.origin !== target.origin ||
            !["/stage/build/app/", "/stage/build/app/index.html", "/stage/build/app/window.html"].includes(ownerURL.pathname)) {
            return {create: false};
        }
        const key = `${target.origin}:${data.key === "builtin" ? "builtin" : event.sender.id + ":" + data.key}`;
        const existing = windows.get(key);
        if (existing && !existing.isDestroyed()) {
            const state = windowStates.get(existing);
            state.data.command = data.command;
            existing.webContents.send("siyuan-settings-command", data.command);
            if (state.shown) show(existing);
            return {create: false};
        }
        const reserved = reservations.get(key);
        if (reserved && reserved.expires >= Date.now() && !reserved.owner.isDestroyed()) {
            reserved.data.command = data.command;
            return {create: false};
        }
        if (reserved) cancel(reserved);
        const url = new URL(settingsPath, target.origin);
        url.searchParams.set("settingsWindowToken", data.token);
        if (target.mode === "remote") {
            url.searchParams.set("remote", "1");
        }
        const frameName = "siyuan-settings-" + data.token;
        const approved = {key, target, owner: event.sender, url: url.href, frameName, data, requestedAt,
            active: true, expires: Date.now() + 60000};
        watchOwner(event.sender).records.add(approved);
        approved.timer = setTimeout(() => cancel(approved), 60000);
        approved.timer.unref();
        pending.set(event.sender.id + ":" + frameName, approved);
        reservations.set(key, approved);
        return {create: true, token: data.token, url: approved.url, frameName};
    });
    return (contents, details) => {
        const pendingKey = contents.id + ":" + details.frameName;
        const approved = pending.get(pendingKey);
        if (!approved || approved.expires < Date.now() || details.url !== approved.url ||
            details.frameName !== approved.frameName) {
            return undefined;
        }
        pending.delete(pendingKey);
        approved.created = win => {
            approved.created = undefined;
            approved.win = win;
            release(approved);
            windows.set(approved.key, win);
            const state = {painted: false, ready: false, shown: false, data: approved.data, approved};
            state.reveal = () => {
                if (!approved.active || !state.ready || !state.painted || state.shown || win.isDestroyed()) return;
                state.shown = true;
                if (state.data.geometry?.maximized) win.maximize();
                show(win);
                win.webContents.setBackgroundThrottling(true);
                win.webContents.send("siyuan-settings-shown");
                log("settings window revealed [" + (Date.now() - approved.requestedAt) + "ms since open request]");
            };
            windowStates.set(win, state);
            win.once("ready-to-show", () => {
                state.painted = true;
                state.reveal();
            });
            if (platform !== "darwin") win.setMenu(null);
            win.webContents.on("before-input-event", (event, input) => {
                const modifiers = platform === "darwin" ? input.meta && input.alt && !input.control && !input.shift :
                    input.control && input.shift && !input.meta && !input.alt;
                if (input.type === "keyDown" && !input.isAutoRepeat && input.key.toLowerCase() === "i" && modifiers) {
                    event.preventDefault();
                    win.webContents.toggleDevTools();
                }
            });
            win.once("closed", () => finish(approved));
            if (approved.data.key === "builtin") {
                let geometryTimer;
                let lastGeometry;
                const saveGeometry = () => {
                    clearTimeout(geometryTimer);
                    if (!approved.active || win.isDestroyed() || contents.isDestroyed()) return;
                    const geometry = captureWindowGeometry(win);
                    if (lastGeometry && Object.keys(geometry).every(key => geometry[key] === lastGeometry[key])) return;
                    contents.send("siyuan-settings-geometry", geometry);
                    lastGeometry = geometry;
                };
                // 合并连续的窗口变化，关闭时立即保存最终状态。
                for (const event of ["resize", "move", "maximize", "unmaximize"]) {
                    win.on(event, () => {
                        clearTimeout(geometryTimer);
                        geometryTimer = setTimeout(saveGeometry, 300);
                    });
                }
                win.on("close", saveGeometry);
                win.once("closed", () => clearTimeout(geometryTimer));
            }
            win.webContents.once("did-finish-load", () => {
                if (approved.active) win.webContents.send("siyuan-settings-command", approved.data.command);
            });
            win.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
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
        return {
            action: "allow",
            overrideBrowserWindowOptions: {
                show: false,
                title: approved.data.title || "SiYuan",
                frame: platform === "darwin",
                titleBarStyle: "hidden",
                trafficLightPosition: {x: 8, y: 8},
                autoHideMenuBar: true,
                fullscreenable: true,
                icon,
                minWidth: 493,
                minHeight: 376,
                width: 1000,
                height: 760,
                ...normalizeWindowGeometry(approved.data.geometry, screen),
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
            },
        };
    };
};

module.exports = {createSettingsWindows};
