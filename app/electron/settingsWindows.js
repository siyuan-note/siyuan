const {normalizeWindowGeometry, captureWindowGeometry} = require("./windowGeometry");

const settingsPath = "/stage/build/app/settings.html";

// 只允许已登记的内核页面打开预先授权的设置页，不改变普通链接的打开规则。
const createSettingsWindows = ({ipcMain, screen, getTarget, initialize, show, log, icon, platform = process.platform}) => {
    const pending = new Map();
    const reservations = new Map();
    const windows = new Map();
    const windowStates = new WeakMap();
    const release = approved => {
        clearTimeout(approved.timer);
        pending.delete(approved.owner.id + ":" + approved.frameName);
        if (reservations.get(approved.key) === approved) reservations.delete(approved.key);
        approved.owner.removeListener("destroyed", approved.cancel);
        if (approved.created) approved.owner.removeListener("did-create-window", approved.created);
    };
    const cancel = approved => {
        release(approved);
        if (!approved.owner.isDestroyed()) approved.owner.send("siyuan-settings-closed", approved.data.token);
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
    ipcMain.on("siyuan-settings-close", (event, key) => {
        const target = getTarget(event.sender.id);
        if (!target || event.senderFrame !== event.sender.mainFrame || typeof key !== "string" ||
            !/^plugin-[a-zA-Z0-9-]+$/.test(key)) return;
        const registryKey = `${target.origin}:${event.sender.id}:${key}`;
        const reserved = reservations.get(registryKey);
        if (reserved) cancel(reserved);
        const win = windows.get(registryKey);
        if (win && !win.isDestroyed()) win.close();
    });
    ipcMain.handle("siyuan-settings-prepare", (event, data) => {
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
        const approved = {key, target, owner: event.sender, url: url.href, frameName, data, expires: Date.now() + 60000};
        approved.cancel = () => cancel(approved);
        approved.timer = setTimeout(approved.cancel, 60000);
        approved.timer.unref();
        event.sender.once("destroyed", approved.cancel);
        pending.set(event.sender.id + ":" + frameName, approved);
        reservations.set(key, approved);
        return {create: true, url: approved.url, frameName};
    });
    return (contents, details) => {
        const pendingKey = contents.id + ":" + details.frameName;
        const approved = pending.get(pendingKey);
        if (!approved || approved.expires < Date.now() || details.url !== approved.url ||
            details.frameName !== approved.frameName) {
            return undefined;
        }
        pending.delete(pendingKey);
        approved.created = (win, created) => {
            if (created.url !== approved.url) return;
            release(approved);
            windows.set(approved.key, win);
            const state = {painted: false, ready: false, shown: false, data: approved.data};
            state.reveal = () => {
                if (!state.ready || !state.painted || state.shown || win.isDestroyed()) return;
                state.shown = true;
                if (state.data.geometry?.maximized) win.maximize();
                show(win);
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
            initialize(win, approved.target);
            const close = () => { if (!win.isDestroyed()) win.destroy(); };
            contents.once("destroyed", close);
            win.on("closed", () => {
                windows.delete(approved.key);
                contents.removeListener("destroyed", close);
                if (!contents.isDestroyed()) {
                    contents.send("siyuan-settings-closed", approved.data.token);
                }
            });
            const saveGeometry = () => {
                if (!win.isDestroyed() && !contents.isDestroyed() && approved.data.key === "builtin") {
                    contents.send("siyuan-settings-geometry", captureWindowGeometry(win));
                }
            };
            for (const event of ["resize", "move", "maximize", "unmaximize", "close"]) {
                win.on(event, saveGeometry);
            }
            win.webContents.once("did-finish-load", () => {
                win.webContents.send("siyuan-settings-command", approved.data.command);
            });
            win.webContents.on("did-fail-load", (_event, code, description) => {
                if (code !== -3) log("settings window failed to load: " + description);
            });
        };
        contents.on("did-create-window", approved.created);
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
                },
            },
        };
    };
};

module.exports = {createSettingsWindows};
