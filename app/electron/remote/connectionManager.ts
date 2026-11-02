import {app, BrowserWindow, ipcMain, session, safeStorage} from "electron";
import {errorMessage} from "../shared/errors";
import * as runtime from "../shared/runtime";
import {APP_PAGE} from "../shared/pagePaths";
import {appIconPath} from "../shared/desktopDefaults";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {pathToFileURL} from "node:url";
import {normalizeRemoteKernelOrigin, getRemoteKernelVersionStatus, getUnsafeRemoteChromiumSwitchName} from "./remoteKernel";
import {probeRemoteKernelAuthentication} from "./remoteKernelAuth";
import {readConnections, writeConnections, remotePartition} from "./connectionStore";
import type {
    BrowserWindow as ElectronBrowserWindow,
    Event as ElectronEvent,
    IpcMainInvokeEvent,
    WebContents,
    WebFrameMain,
} from "electron";
import type {LogFunction} from "../shared/types";
import {Channel} from "../shared/channels";

type ConnectionTarget = {origin: string};

// 会话交接只在本次客户端重启期间有效，过期文件在创建管理器时清理。
const SESSION_HANDOFF_TTL_MS = 300000;
const SESSION_HANDOFF_TOKEN_BYTES = 24;
const SESSION_HANDOFF_FILE_PATTERN = /^connection-session-[a-f0-9]{48}\.bin$/;
const MAX_HISTORY_ORIGINS = 50;
const INVALID_CONNECTION_OPERATION = "Invalid connection operation";
const CANCELED = "Canceled";

const sessionHandoffFile = (confDir: string, token: string): string =>
    path.join(confDir, "connection-session-" + token + ".bin");

type ConnectionHistory = {
    version: number;
    origins: string[];
    migrated?: string[];
    trustedOrigins: string[];
    [key: string]: unknown;
};

type ConnectionSessionResponse = {
    ok: boolean;
    status: number;
    body?: {cancel: () => Promise<void>} | null;
    json: () => Promise<Record<string, any>>;
    arrayBuffer: () => Promise<ArrayBuffer>;
};

// 分区会话仍是 Electron 的 Session，直接对外暴露真实类型，调用方无需断言。
type ConnectionSession = Electron.Session;

type RestartTarget = {
    mode: string;
    origin: string;
    lang: string;
    trustRemoteExtensions: boolean;
    sessionHandoff?: string;
};

type ConnectionManagerOptions = {
    confDir: string;
    languageDir: string;
    assetsDir?: string;
    restart: (target: RestartTarget) => Promise<void>;
    currentTarget: () => ConnectionTarget | undefined;
    version: string;
    log: LogFunction;
    showWindow?: boolean;
    isTrustedDialogSender?: (event: {senderFrame: {url: string} | null; sender: WebContents}) => boolean;
};

const getRemoteSession = (target: ConnectionTarget): ConnectionSession =>
    session.fromPartition(remotePartition(target.origin));

const createConnectionManager = ({confDir, languageDir, assetsDir = runtime.paths.assetsDir, restart, currentTarget,
    version, log, showWindow = true,
    isTrustedDialogSender = (() => false) as (event: {senderFrame: {url: string} | null; sender: WebContents}) => boolean}: ConnectionManagerOptions) => {
    const file = path.join(confDir, "connections.json");
    const page = pathToFileURL(path.join(assetsDir, "connections.html")).href;
    // 连接管理窗口的状态按使用顺序分三段：
    // 1. 打开：show/init 写入 language、initialOrigin 与 initialError，并把对话框的发送方登记为 dialogSender；
    // 2. 校验与登录：check 记录 checkedOrigin 与 authenticatedOrigin，login 与 captcha 都以 checkedOrigin 为前提；
    // 3. 打开连接：open 要求 checkedOrigin 与 authenticatedOrigin 都等于本次 origin，随后重启应用切换连接。
    // releaseDialog 清空对话框发送方、取消信号与校验结果，可重复调用。
    let window: ElectronBrowserWindow | undefined;
    let language = "en";
    let initialOrigin = "";
    let initialError = "";
    let controller: AbortController | undefined;
    let checkedOrigin: string | undefined;
    let authenticatedOrigin: string | undefined;
    let dialogSender: WebContents | undefined;
    let dialogFrame: WebFrameMain | undefined;
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
            if (SESSION_HANDOFF_FILE_PATTERN.test(name)) {
                const handoff = path.join(confDir, name);
                if (fs.statSync(handoff).mtimeMs < Date.now() - SESSION_HANDOFF_TTL_MS) {
                    fs.unlinkSync(handoff);
                }
            }
        }
    } catch (error) {
        if (!(error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT")) {
            log("clean expired connection sessions: " + errorMessage(error));
        }
    }
    const languages = () => {
        try {
            return JSON.parse(fs.readFileSync(path.join(languageDir, language + ".json"), "utf8"));
        } catch (error) {
            return JSON.parse(fs.readFileSync(path.join(languageDir, "en.json"), "utf8"));
        }
    };
    const updateHistory = (change: (data: ConnectionHistory) => void): void => {
        const data = readConnections(file);
        change(data);
        writeConnections(file, data);
    };
    const remember = (origin: string): void => updateHistory((history: ConnectionHistory) => {
        history.origins = [origin, ...history.origins.filter(item => item !== origin)].slice(0, MAX_HISTORY_ORIGINS);
    });
    // 仅为本次客户端重启短暂交接会话 Cookie，使用系统加密，不保存原始授权码。
    const stageSession = async (origin: string): Promise<string | undefined> => {
        const cookies = (await getRemoteSession({origin}).cookies.get({url: origin})).filter(cookie => cookie.session);
        if (cookies.length === 0 || !safeStorage.isEncryptionAvailable() ||
            (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) {
            return;
        }
        const token = crypto.randomBytes(SESSION_HANDOFF_TOKEN_BYTES).toString("hex");
        const payload = {version: 1, origin, expires: Date.now() + SESSION_HANDOFF_TTL_MS, cookies};
        fs.writeFileSync(sessionHandoffFile(confDir, token),
            safeStorage.encryptString(JSON.stringify(payload)), {mode: 0o600, flag: "wx"});
        return token;
    };
    const restoreSession = async (target: ConnectionTarget, token?: string): Promise<void> => {
        if (!token) {
            return;
        }
        if (!/^[a-f0-9]{48}$/.test(token)) {
            throw new Error("Invalid session handoff");
        }
        const handoff = sessionHandoffFile(confDir, token);
        if (!fs.existsSync(handoff)) {
            return;
        }
        const payload: {version: number; origin: string; expires: number; cookies: Record<string, any>[]} =
            JSON.parse(safeStorage.decryptString(fs.readFileSync(handoff)));
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
    const setSessionCookie = (remoteSession: ConnectionSession, origin: string,
        cookie: Record<string, any>): Promise<void> => {
        const details = {...cookie};
        delete details.hostOnly;
        delete details.session;
        if (cookie.hostOnly) {
            delete details.domain;
        }
        return remoteSession.cookies.set({...details, url: origin + cookie.path});
    };
    // 首次使用独立会话时迁移现有登录 Cookie，不影响已有远程连接的登录状态。
    const prepareSession = async (target: ConnectionTarget): Promise<ConnectionSession> => {
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
    const request = async (origin: string, pathname: string, signal: AbortSignal,
        options: Record<string, unknown> = {}): Promise<ConnectionSessionResponse> => {
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
        return history.origins.map((origin: string) => ({mode: "remote", origin,
            trustRemoteExtensions: history.trustedOrigins.includes(origin)}));
    };
    const setTrust = (history: ConnectionHistory, origin: string, trusted: boolean): void => {
        history.trustedOrigins = history.trustedOrigins.filter(item => item !== origin && history.origins.includes(item));
        if (trusted === true) {
            history.trustedOrigins.push(origin);
        }
    };
    // 语言标记只接受 en / en-US 这类写法，其余一律退回系统语言。
    const requestedLanguage = (value: unknown): string =>
        typeof value === "string" && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value) ? value : app.getLocale();
    // 这三条命令要访问内核，失败时页面额外提示「连接失败」。
    const isProbeCommand = (cmd: string): boolean => ["check", "login", "captcha"].includes(cmd);

    // 主界面打开连接管理对话框：登记发送方、语言与初始地址，并让旧窗口退出。
    const openDialogSession = (event: IpcMainInvokeEvent, data: Record<string, any>): void => {
        releaseDialog();
        if (window && !window.isDestroyed()) {
            window.close();
        }
        dialogSender = event.sender;
        dialogFrame = event.senderFrame ?? undefined;
        dialogSender.once("destroyed", releaseDialog);
        language = requestedLanguage(data.lang);
        initialOrigin = data.origin || currentTarget()?.origin || "";
        initialError = "";
    };

    // 仅接受已登记的主界面对话框，或本机连接页主框架发出的请求。
    const isFromDialog = (event: IpcMainInvokeEvent): boolean =>
        event.sender === dialogSender && event.senderFrame === dialogFrame && isTrustedDialogSender(event);
    const isFromWindow = (event: IpcMainInvokeEvent): boolean =>
        !dialogSender && !!window && !window.isDestroyed() && event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === page;

    // 地址归一化失败时换成界面文案，避免把内部校验信息透给页面。
    const normalizeOrigin = (value: string): string => {
        try {
            return normalizeRemoteKernelOrigin(value);
        } catch (error) {
            throw new Error(languages().remoteKernelAddressTip, {cause: error});
        }
    };

    ipcMain.handle(Channel.SIYUAN_CONNECTIONS, async (event: IpcMainInvokeEvent,
        data: Record<string, any>): Promise<Record<string, any>> => {
        // 对话框首次打开必须在发送方校验之前登记，后续命令才被认作来自它。
        if (data.cmd === "init" && data.dialog && isTrustedDialogSender(event)) {
            openDialogSession(event, data);
        }
        const fromDialog = isFromDialog(event);
        if (!fromDialog && !isFromWindow(event)) {
            return {error: "Invalid connection manager sender"};
        }
        try {
            return await handleCommand(fromDialog, data);
        } catch (error) {
            log("connection manager: " + errorMessage(error));
            return {error: (isProbeCommand(data.cmd) ? languages().remoteKernelConnectionFailed + "\n" : "") +
                errorMessage(error)};
        }
    });

    // 命令按用途分三组：窗口命令、连接历史、需要访问内核的探测命令。
    const handleCommand = async (fromDialog: boolean, data: Record<string, any>): Promise<Record<string, any>> => {
        switch (data.cmd) {
            case "close":
                if (fromDialog) {
                    releaseDialog();
                } else if (window) {
                    window.close();
                }
                return {};

            case "minimize":
                if (!fromDialog && window) {
                    window.minimize();
                }
                return {};

            case "init": {
                // 读取历史失败也要让页面显示出来，错误随数据回到渲染进程。
                let entries: ReturnType<typeof list> = [];
                let error = initialError;
                try {
                    entries = list();
                } catch (cause) {
                    error = errorMessage(cause);
                }
                return {languages: languages(), lang: language, origin: initialOrigin, error, entries};
            }

            case "cancel":
                controller?.abort();
                checkedOrigin = undefined;
                authenticatedOrigin = undefined;
                return {};

            case "remove": {
                const origin = normalizeRemoteKernelOrigin(data.origin);
                updateHistory(history => {
                    history.origins = history.origins.filter(item => item !== origin);
                    setTrust(history, origin, false);
                });
                return {entries: list()};
            }

            case "trust": {
                const origin = normalizeOrigin(data.origin);
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

            case "open": {
                const origin = normalizeOrigin(data.origin);
                // 只允许打开刚校验并登录过的地址。
                if (checkedOrigin !== origin || authenticatedOrigin !== origin) {
                    throw new Error(languages().remoteKernelConnectionFailed);
                }
                await getRemoteSession({origin}).cookies.flushStore();
                const trustRemoteExtensions = data.trustRemoteExtensions === true;
                updateHistory(history => {
                    history.origins = [origin, ...history.origins.filter(item => item !== origin)].slice(0, MAX_HISTORY_ORIGINS);
                    setTrust(history, origin, trustRemoteExtensions);
                });
                await restart({mode: "remote", origin, lang: language, trustRemoteExtensions,
                    sessionHandoff: await stageSession(origin)});
                return {};
            }

            case "check":
            case "login":
            case "captcha":
                return runRemoteProbe(data.cmd, normalizeOrigin(data.origin), data);

            default:
                throw new Error(INVALID_CONNECTION_OPERATION);
        }
    };

    // 探测命令共用一次可取消的本机请求：先准备会话，再按命令取结果。
    const runRemoteProbe = async (cmd: string, origin: string,
        data: Record<string, any>): Promise<Record<string, any>> => {
        controller?.abort();
        controller = new AbortController();
        const activeController = controller;
        const signal = activeController.signal;
        const timer = setTimeout(() => activeController.abort(), 10000);
        try {
            if (process.argv.some(getUnsafeRemoteChromiumSwitchName)) {
                throw new Error(languages().remoteKernelConnectionFailed + " (Chromium)");
            }
            await prepareSession({origin});
            if (signal.aborted) {
                throw new Error(CANCELED);
            }
            if (cmd === "check") {
                checkedOrigin = undefined;
                authenticatedOrigin = undefined;
                const versionData = await (await request(origin, "/api/system/version", signal)).json();
                if (getRemoteKernelVersionStatus(versionData, version) !== "compatible") {
                    throw new Error(languages().remoteKernelVersionMismatch + " (" + version + ")");
                }
                const authenticated = await probeRemoteKernelAuthentication({
                    session: getRemoteSession({origin}), url: origin + APP_PAGE,
                });
                if (signal.aborted) {
                    throw new Error(CANCELED);
                }
                checkedOrigin = origin;
                authenticatedOrigin = authenticated ? origin : undefined;
                return {authenticated};
            }
            if (cmd === "login" && checkedOrigin === origin) {
                const result = await (await request(origin, "/api/system/loginAuth", signal, {
                    method: "POST", headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({authCode: data.authCode, captcha: data.captcha, rememberMe: data.rememberMe}),
                })).json();
                if (signal.aborted) {
                    throw new Error(CANCELED);
                }
                authenticatedOrigin = result.code === 0 ? origin : undefined;
                return {authenticated: result.code === 0, captcha: result.code === 1, error: result.msg};
            }
            if (cmd === "captcha" && checkedOrigin === origin) {
                const response = await request(origin, "/api/system/getCaptcha?v=" + Date.now(), signal);
                return {image: "data:image/png;base64," + Buffer.from(await response.arrayBuffer()).toString("base64")};
            }
            throw new Error(INVALID_CONNECTION_OPERATION);
        } finally {
            clearTimeout(timer);
        }
    };
    const show = (options: {origin?: string, error?: string, lang?: string} = {}) => {
        releaseDialog();
        if (window && !window.isDestroyed()) {
            if (options.origin || options.error) {
                window.webContents.send(Channel.SIYUAN_CONNECTION_TARGET, {origin: options.origin, error: options.error});
            }
            window.show();
            window.focus();
            return window.id;
        }
        language = requestedLanguage(options.lang);
        initialOrigin = options.origin || currentTarget()?.origin || "";
        initialError = options.error || "";
        checkedOrigin = undefined;
        authenticatedOrigin = undefined;
        window = new BrowserWindow({width: 720, height: 600, minWidth: 560, minHeight: 480, show: showWindow,
            title: languages().connectRemoteKernel, autoHideMenuBar: true,
            frame: process.platform === "darwin", titleBarStyle: "hidden", fullscreenable: false,
            icon: appIconPath(),
            webPreferences: {nodeIntegration: true, contextIsolation: false, webSecurity: true,
                partition: "siyuan-connection-manager"}});
        window.webContents.on("will-navigate", (event: ElectronEvent) => event.preventDefault());
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

export {createConnectionManager, getRemoteSession};
