const {app, BrowserWindow, ipcMain, session, net, safeStorage} = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {normalizeRemoteKernelOrigin, getRemoteKernelVersionStatus, getUnsafeRemoteChromiumSwitchName} = require("./remoteKernel");
const {probeRemoteKernelAuthentication} = require("./remoteKernelAuth");
const {readConnections, writeConnections, remotePartition} = require("./connectionStore");

const getRemoteSession = (target) => session.fromPartition(remotePartition(target.origin));

const createConnectionManager = ({confDir, languageDir, restart, currentTarget, version, log, showWindow = true,
    isTrustedDialogSender = () => false}) => {
    const file = path.join(confDir, "connections.json");
    const page = pathToFileURL(path.join(__dirname, "connections.html")).href;
    let window;
    let language = "en";
    let initialOrigin = "";
    let initialError = "";
    let controller;
    let checkedOrigin;
    let authenticatedOrigin;
    let dialogSender;
    let dialogFrame;
    const releaseDialog = () => {
        dialogSender?.removeListener("destroyed", releaseDialog);
        dialogSender = undefined;
        dialogFrame = undefined;
        controller?.abort();
        checkedOrigin = undefined;
        authenticatedOrigin = undefined;
    };
    try {
        for (const name of fs.readdirSync(confDir)) {
            if (/^connection-session-[a-f0-9]{48}\.bin$/.test(name)) {
                const handoff = path.join(confDir, name);
                if (fs.statSync(handoff).mtimeMs < Date.now() - 300000) {
                    fs.unlinkSync(handoff);
                }
            }
        }
    } catch (error) {
        if (error.code !== "ENOENT") {
            log("clean expired connection sessions: " + error.message);
        }
    }
    const languages = () => {
        try {
            return JSON.parse(fs.readFileSync(path.join(languageDir, language + ".json"), "utf8"));
        } catch (error) {
            return JSON.parse(fs.readFileSync(path.join(languageDir, "en.json"), "utf8"));
        }
    };
    const updateHistory = (change) => {
        const data = readConnections(file);
        change(data);
        writeConnections(file, data);
    };
    const remember = (origin) => updateHistory(history => {
        history.origins = [origin, ...history.origins.filter(item => item !== origin)].slice(0, 50);
    });
    // 仅为本次客户端重启短暂交接会话 Cookie，使用系统加密，不保存原始授权码。
    const stageSession = async (origin) => {
        const cookies = (await getRemoteSession({origin}).cookies.get({url: origin})).filter(cookie => cookie.session);
        if (cookies.length === 0 || !safeStorage.isEncryptionAvailable() ||
            (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) {
            return;
        }
        const token = crypto.randomBytes(24).toString("hex");
        const payload = {version: 1, origin, expires: Date.now() + 300000, cookies};
        fs.writeFileSync(path.join(confDir, "connection-session-" + token + ".bin"),
            safeStorage.encryptString(JSON.stringify(payload)), {mode: 0o600, flag: "wx"});
        return token;
    };
    const restoreSession = async (target, token) => {
        if (!token) {
            return;
        }
        if (!/^[a-f0-9]{48}$/.test(token)) {
            throw new Error("Invalid session handoff");
        }
        const handoff = path.join(confDir, "connection-session-" + token + ".bin");
        if (!fs.existsSync(handoff)) {
            return;
        }
        const payload = JSON.parse(safeStorage.decryptString(fs.readFileSync(handoff)));
        if (payload.version !== 1 || payload.origin !== target.origin || !Array.isArray(payload.cookies)) {
            throw new Error("Invalid session handoff target");
        }
        if (payload.expires > Date.now()) {
            for (const cookie of payload.cookies) {
                await setSessionCookie(getRemoteSession(target), target.origin, cookie);
            }
        }
        await getRemoteSession(target).cookies.flushStore();
        fs.unlinkSync(handoff);
    };
    const setSessionCookie = (remoteSession, origin, cookie) => {
        const details = {...cookie};
        delete details.hostOnly;
        delete details.session;
        if (cookie.hostOnly) {
            delete details.domain;
        }
        return remoteSession.cookies.set({...details, url: origin + cookie.path});
    };
    // 首次使用独立会话时迁移现有登录 Cookie，不影响已有远程连接的登录状态。
    const prepareSession = async (target) => {
        const remoteSession = getRemoteSession(target);
        const history = readConnections(file);
        if (!(history.migrated || []).includes(target.origin)) {
            const cookies = await session.defaultSession.cookies.get({url: target.origin});
            for (const cookie of cookies) {
                await setSessionCookie(remoteSession, target.origin, cookie);
            }
            await remoteSession.cookies.flushStore();
            updateHistory(data => {
                data.migrated = [...new Set([...(data.migrated || []), target.origin])];
            });
        }
        return remoteSession;
    };
    const request = async (origin, pathname, signal, options = {}) => {
        const response = await getRemoteSession({origin}).fetch(origin + pathname, {
            ...options, credentials: "include", bypassCustomProtocolHandlers: true, redirect: "manual",
            signal,
        });
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error("HTTP " + response.status);
        }
        return response;
    };
    const list = () => {
        const history = readConnections(file);
        return history.origins.map(origin => ({mode: "remote", origin,
            trustRemoteExtensions: history.trustedOrigins.includes(origin)}));
    };
    const setTrust = (history, origin, trusted) => {
        history.trustedOrigins = history.trustedOrigins.filter(item => item !== origin && history.origins.includes(item));
        if (trusted === true) {
            history.trustedOrigins.push(origin);
        }
    };
    ipcMain.handle("siyuan-connections", async (event, data) => {
        if (data.cmd === "init" && data.dialog && isTrustedDialogSender(event)) {
            releaseDialog();
            if (window && !window.isDestroyed()) {
                window.close();
            }
            dialogSender = event.sender;
            dialogFrame = event.senderFrame;
            dialogSender.once("destroyed", releaseDialog);
            language = /^[a-z]{2}(?:-[A-Z]{2})?$/.test(data.lang || "") ? data.lang : app.getLocale();
            initialOrigin = data.origin || currentTarget()?.origin || "";
            initialError = "";
        }
        // 仅接受已登记的主界面对话框或本机连接页主框架发出的请求。
        const fromDialog = event.sender === dialogSender && event.senderFrame === dialogFrame &&
            isTrustedDialogSender(event);
        const fromWindow = !dialogSender && window && !window.isDestroyed() && event.sender === window.webContents &&
            event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === page;
        if (!fromDialog && !fromWindow) {
            return {error: "Invalid connection manager sender"};
        }
        try {
            if (data.cmd === "close") {
                if (fromDialog) {
                    releaseDialog();
                } else {
                    window.close();
                }
                return {};
            }
            if (data.cmd === "minimize") {
                if (fromWindow) {
                    window.minimize();
                }
                return {};
            }
            if (data.cmd === "init") {
                let entries = [];
                let error = initialError;
                try {
                    entries = list();
                } catch (cause) {
                    error = String(cause.message);
                }
                return {languages: languages(), lang: language, origin: initialOrigin, error, entries};
            }
            if (data.cmd === "cancel") {
                controller?.abort();
                checkedOrigin = undefined;
                authenticatedOrigin = undefined;
                return {};
            }
            if (data.cmd === "remove") {
                const origin = normalizeRemoteKernelOrigin(data.origin);
                updateHistory(history => {
                    history.origins = history.origins.filter(item => item !== origin);
                    setTrust(history, origin, false);
                });
                return {entries: list()};
            }
            let origin;
            try {
                origin = normalizeRemoteKernelOrigin(data.origin);
            } catch (error) {
                throw new Error(languages().remoteKernelAddressTip);
            }
            if (data.cmd === "trust") {
                if (typeof data.trustRemoteExtensions !== "boolean") {
                    throw new Error(languages().remoteKernelConnectionFailed);
                }
                updateHistory(history => {
                    if (!history.origins.includes(origin)) {
                        throw new Error(languages().remoteKernelConnectionFailed);
                    }
                    setTrust(history, origin, data.trustRemoteExtensions);
                });
                return {entries: list()};
            }
            if (data.cmd === "open") {
                if (checkedOrigin !== origin || authenticatedOrigin !== origin) {
                    throw new Error(languages().remoteKernelConnectionFailed);
                }
                await getRemoteSession({origin}).cookies.flushStore();
                const trustRemoteExtensions = data.trustRemoteExtensions === true;
                updateHistory(history => {
                    history.origins = [origin, ...history.origins.filter(item => item !== origin)].slice(0, 50);
                    setTrust(history, origin, trustRemoteExtensions);
                });
                await restart({mode: "remote", origin, lang: language, trustRemoteExtensions,
                    sessionHandoff: await stageSession(origin)});
                return {};
            }
            controller?.abort();
            controller = new AbortController();
            const activeController = controller;
            const timer = setTimeout(() => activeController.abort(), 10000);
            try {
                if (process.argv.some(getUnsafeRemoteChromiumSwitchName)) {
                    throw new Error(languages().remoteKernelConnectionFailed + " (Chromium)");
                }
                await prepareSession({origin});
                if (activeController.signal.aborted) {
                    throw new Error("Canceled");
                }
                if (data.cmd === "check") {
                    checkedOrigin = undefined;
                    authenticatedOrigin = undefined;
                    const versionData = await (await request(origin, "/api/system/version", activeController.signal)).json();
                    if (getRemoteKernelVersionStatus(versionData, version) !== "compatible") {
                        throw new Error(languages().remoteKernelVersionMismatch + " (" + version + ")");
                    }
                    const authenticated = await probeRemoteKernelAuthentication(net, getRemoteSession({origin}),
                        origin + "/stage/build/app/");
                    if (activeController.signal.aborted) {
                        throw new Error("Canceled");
                    }
                    checkedOrigin = origin;
                    authenticatedOrigin = authenticated ? origin : undefined;
                    return {authenticated};
                }
                if (data.cmd === "login" && checkedOrigin === origin) {
                    const result = await (await request(origin, "/api/system/loginAuth", activeController.signal, {
                        method: "POST", headers: {"Content-Type": "application/json"},
                        body: JSON.stringify({authCode: data.authCode, captcha: data.captcha, rememberMe: data.rememberMe}),
                    })).json();
                    if (activeController.signal.aborted) {
                        throw new Error("Canceled");
                    }
                    authenticatedOrigin = result.code === 0 ? origin : undefined;
                    return {authenticated: result.code === 0, captcha: result.code === 1, error: result.msg};
                }
                if (data.cmd === "captcha" && checkedOrigin === origin) {
                    const response = await request(origin, "/api/system/getCaptcha?v=" + Date.now(), activeController.signal);
                    return {image: "data:image/png;base64," + Buffer.from(await response.arrayBuffer()).toString("base64")};
                }
                throw new Error("Invalid connection operation");
            } finally {
                clearTimeout(timer);
            }
        } catch (error) {
            log("connection manager: " + error.message);
            return {error: (["check", "login", "captcha"].includes(data.cmd)
                ? languages().remoteKernelConnectionFailed + "\n" : "") + String(error.message)};
        }
    });
    const show = (options = {}) => {
        releaseDialog();
        if (window && !window.isDestroyed()) {
            if (options.origin || options.error) {
                window.webContents.send("siyuan-connection-target", {origin: options.origin, error: options.error});
            }
            window.show();
            window.focus();
            return window.id;
        }
        language = /^[a-z]{2}(?:-[A-Z]{2})?$/.test(options.lang || "") ? options.lang : app.getLocale();
        initialOrigin = options.origin || currentTarget()?.origin || "";
        initialError = options.error || "";
        checkedOrigin = undefined;
        authenticatedOrigin = undefined;
        window = new BrowserWindow({width: 720, height: 600, minWidth: 560, minHeight: 480, show: showWindow,
            title: languages().connectRemoteKernel, autoHideMenuBar: true,
            frame: process.platform === "darwin", titleBarStyle: "hidden", fullscreenable: false,
            icon: path.join(__dirname, "..", "stage", "icon-large.png"),
            webPreferences: {nodeIntegration: true, contextIsolation: false, webSecurity: true,
                partition: "siyuan-connection-manager"}});
        window.webContents.on("will-navigate", event => event.preventDefault());
        window.webContents.setWindowOpenHandler(() => ({action: "deny"}));
        window.on("closed", () => {
            controller?.abort();
            window = undefined;
            if (BrowserWindow.getAllWindows().length === 0) {
                app.quit();
            }
        });
        window.loadURL(page);
        return window.id;
    };
    return {show, prepareSession, restoreSession, remember};
};

module.exports = {createConnectionManager, getRemoteSession};
