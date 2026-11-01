// 内核启动编排：登记启动状态、拉起内核进程、轮询版本与启动进度，并在失败时给出对应窗口。
// 本机请求（localKernelRequest）、启动预算（kernelBootBudget）与启动诊断（kernelDiagnostics）各自独立，
// 本文件只保留编排；内建依赖与协作者按组注入，入口只传会变化的部分。
import {
    BOOT_ANIMATION_SETTLE_MS, BOOT_TIMEOUT_MS, LOCK_RETRY_DEADLINE_MS, PROGRESS_FAILURE_LIMIT,
    PROGRESS_POLL_INTERVAL_MS, PROGRESS_RETRY_INTERVAL_MS, VERSION_RETRY_INTERVAL_MS,
    bootTimedOut, canRetryProgress, exhaustedVersionAttempts, isLocalKernelRequestTimeout, lockRetryExpired,
} from "./kernelBootBudget";
import {describeKernelExit} from "./kernelExitCodes";
import {collectWindowsTCPConfig} from "./kernelDiagnostics";
import {createLocalKernelRequest} from "./localKernelRequest";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs";
import * as nodeChildProcess from "node:child_process";
import * as electron from "electron";
import * as runtime from "../shared/runtime";
import * as kernelEndpoint from "./kernelEndpoint";
import * as errorWindow from "../shared/errorWindow";
import * as languageModule from "../shared/language";
import * as timing from "../shared/timing";
import * as previousKernelExit from "./previousKernelExit";
import * as appleSiliconWarning from "./appleSiliconWarning";
import {errorMessage, toError} from "../shared/errors";
import {
    bootTimeoutMessage, escapeHTML, kernelPortUnavailableMessage, kernelProgramMissingMessage,
    workspaceLockedMessage,
} from "../shared/staticMessages";
import type {StaticMessage} from "../shared/staticMessages";
import type {BrowserWindow} from "electron";
import type {
    BootWindowsApi, InitKernel, KernelExitOptions, KernelStartRequest, KernelStartup, Workspace,
} from "../shared/types";

/** 锁冲突重试的轮询节奏。 */
const LOCK_RETRY_POLL_INTERVAL_MS = 100;
const LOCK_RETRY_POLL_WINDOW_MS = 1000;

/** 本机内核请求的超时上限：内核可能已监听端口，但请求既不会成功也不会失败，因此必须限时失败。 */
const MAX_LOCAL_KERNEL_REQUEST_TIMEOUT_MS = 5000;

/** 一次锁冲突等待的结果；notify-failed 表示写入启动页提示时异常。 */
type LockReleaseOutcome =
    | {kind: "retry"}
    | {kind: "canceled"}
    | {kind: "expired"}
    | {kind: "notify-failed"; error: unknown};

// 工作空间被占用时的等待：先写入提示，再等一小段时间让内核完成退出，交由调用方决定是否继续重试。
const waitForWorkspaceLockRelease = async ({
    now, sleep, deadline, canceled, notify,
}: {
    now: () => number;
    sleep: (ms: number) => Promise<unknown>;
    /** 自动重试的最后期限。 */
    deadline: number;
    canceled: () => boolean;
    /** 把「等待上一个工作空间退出」的提示写进启动页。 */
    notify: () => Promise<void>;
}): Promise<LockReleaseOutcome> => {
    if (lockRetryExpired(now(), deadline)) {
        return {kind: "expired"};
    }
    try {
        await notify();
    } catch (error) {
        return {kind: "notify-failed", error};
    }
    for (let elapsed = 0; elapsed < LOCK_RETRY_POLL_WINDOW_MS && !canceled();
        elapsed += LOCK_RETRY_POLL_INTERVAL_MS) {
        await sleep(LOCK_RETRY_POLL_INTERVAL_MS);
    }
    if (canceled()) {
        return {kind: "canceled"};
    }
    if (lockRetryExpired(now(), deadline)) {
        return {kind: "expired"};
    }
    return {kind: "retry"};
};

/** 一次内核启动尝试的共享状态；内核进程退出时也会经由 settle 结束尝试。 */
type KernelAttempt = {
    startup: KernelStartup;
    request: KernelStartRequest;
    settle: (result: string | number | false) => void;
    kernelPort: string | number;
    kernelPath: string;
    /** 启动页已关闭或本次启动被取消。 */
    canceled: () => boolean;
    /** 内核进程的退出标记与版本就绪标记。 */
    run: {exited: boolean; started: boolean};
};

/** 本次启动已不可继续：启动页已关闭、启动被取消，或内核进程已退出。 */
const bootCanceled = (attempt: KernelAttempt): boolean => attempt.canceled() || attempt.run.exited;

/** 启动已被取消时结束本次尝试，返回 true 表示调用方应直接退出轮询。 */
const settleIfCanceled = (attempt: KernelAttempt): boolean => {
    if (!bootCanceled(attempt)) {
        return false;
    }
    attempt.settle(false);
    return true;
};

/** 工作空间的内核日志路径，没有工作空间时返回空串。 */
const getWorkspaceLogPath = (path: Pick<typeof nodePath, "resolve">, workspace: string | undefined): string =>
    workspace ? path.resolve(workspace, "temp", "siyuan.log") : "";

// 一次尝试可能从三条路径结束：就绪轮询返回、内核进程 close 回调、before-quit 取消。
// settle 只生效一次，后到的路径不会覆盖已经交回的结果。
// 尝试抛出异常时必须在这里结算，否则调用方会永久等待。
const initKernelAttempt = (startup: KernelStartup, request: KernelStartRequest,
    runAttempt: (startup: KernelStartup, request: KernelStartRequest,
        settle: (result: string | number | false) => void) => Promise<void>,
    log: (message: string) => void): Promise<string | number | false> =>
    new Promise<string | number | false>((resolve) => {
        let settled = false;
        const settle = (result: string | number | false): void => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(result);
        };
        void runAttempt(startup, request, settle).catch((error: unknown) => {
            log("kernel startup attempt failed: " + errorMessage(error));
            settle(false);
        });
    });

/** 生产依赖：kernel 不能引用 window 目录，这两组能力只能由入口注入。 */
type KernelBootDeps = {
    boot: Pick<BootWindowsApi, "createBootWindow" | "getAvailablePort" | "showLocalBootWindow">;
    ui: {
        showWindow: (window: BrowserWindow) => void;
        exitApp: (port: string | number, errorWindowId?: number) => void;
        showErrorWindow?: typeof errorWindow.showErrorWindow;
    };
};

// 测试接缝：每项默认取真实实现，生产不传。
// 内建依赖只声明本模块真正用到的方法，签名从真实模块派生，上游改动后不会留下过期的副本。
type KernelBootSeams = {
    path?: Pick<typeof nodePath, "resolve" | "join">;
    process?: Pick<NodeJS.Process, "platform" | "env">;
    fs?: Pick<typeof nodeFs, "existsSync">;
    // 只驱动内核进程：spawn 的返回值仅用于 pid 与退出事件，因此收窄到这两项。
    childProcess?: {
        execFile: typeof nodeChildProcess.execFile;
        spawn: (command: string, args: string[], options: {detached: boolean; stdio: "ignore"}) =>
            import("node:child_process").ChildProcess;
    };
    /** 计时与等待：虚拟时间测试整体替换。 */
    now?: () => number;
    sleep?: (ms: number) => Promise<unknown>;
    scheduleTimer?: (callback: () => void, ms: number) => unknown;
    cancelTimer?: (timer: unknown) => void;
    requestKernelExit?: (port: string | number, options: KernelExitOptions) => unknown;
    waitForPreviousWorkspaceExit?: typeof previousKernelExit.waitForPreviousWorkspaceExit;
    watchWorkspaceExitProcess?: typeof previousKernelExit.watchWorkspaceExitProcess;
    requestWorkspaceExitRecovery?: typeof previousKernelExit.requestWorkspaceExitRecovery;
    showAppleSiliconWarning?: (lang?: string) => Promise<boolean>;
};

const createKernelBoot = ({
    boot: {createBootWindow, getAvailablePort, showLocalBootWindow},
    ui: {showWindow, exitApp, showErrorWindow = errorWindow.showErrorWindow},
}: KernelBootDeps, {
    path = nodePath, process = globalThis.process, fs = nodeFs,
    childProcess = nodeChildProcess,
    now = () => Date.now(), sleep = timing.sleep, scheduleTimer = setTimeout,
    cancelTimer = (timer: unknown) => clearTimeout(timer as NodeJS.Timeout | undefined),
    requestKernelExit = kernelEndpoint.requestKernelExit,
    waitForPreviousWorkspaceExit = previousKernelExit.waitForPreviousWorkspaceExit,
    watchWorkspaceExitProcess = previousKernelExit.watchWorkspaceExitProcess,
    requestWorkspaceExitRecovery = previousKernelExit.requestWorkspaceExitRecovery,
    showAppleSiliconWarning = appleSiliconWarning.showAppleSiliconWarning,
}: KernelBootSeams = {}) => {
    const {state, paths, writeLog} = runtime;
    const {app, net, dialog} = electron;
    // 静态文案自带中英双语，组装成错误窗口的三段参数。
    const showStaticMessage = (message: StaticMessage, options?: errorWindow.ErrorWindowOptions) =>
        showErrorWindow(message.titleZh, message.titleEn, message.content, options);
    const showWorkspaceLocked = () => {
        if (state.workspaces && 0 < state.workspaces.length) {
            showWindow(state.workspaces[0].browserWindow);
        }
        return showStaticMessage(workspaceLockedMessage);
    };

    const fetchLocalKernelJSON = createLocalKernelRequest({
        fetch: (url, init) => net.fetch(url, init),
        timeoutMs: MAX_LOCAL_KERNEL_REQUEST_TIMEOUT_MS,
        scheduleTimer,
        cancelTimer,
    });

    // 内核已经启动但本机请求一直没有响应时的错误窗口，提示用户排查本机访问。
    const showKernelUnresponsiveWindow = (lang?: string): void => {
        const language = languageModule.resolveAppLanguage(lang ? [lang] : app.getPreferredSystemLanguages());
        const languages = languageModule.loadAppMenuLanguages(language);
        const english = languageModule.loadAppMenuLanguages("en");
        const content = [...new Set([languages, english])].map((strings) => {
            const message = escapeHTML(strings.kernelUnresponsiveMessage)
                .replace("${log}", "<a href=\"#\" data-log-path>~/.config/siyuan/app.log</a>");
            const windowsHint = "win32" === process.platform ?
                "<div>" + escapeHTML(strings.kernelUnresponsiveWindowsHint) + "</div>" : "";
            return "<div>" + message + "</div>" + windowsHint;
        }).join("");
        showErrorWindow(languages.kernelUnresponsiveTitle ?? "", english.kernelUnresponsiveTitle ?? "",
            content, {emoji: "⚠️", logPath: path.join(paths.confDir, "app.log")});
        // 诊断命令在后台执行，不延迟结束本次启动流程。
        collectWindowsTCPConfig({platform: process.platform, execFile: childProcess.execFile})
            .then(lines => lines.forEach(line => writeLog(line)))
            .catch(error => writeLog("collect Windows TCP configuration failed: " + errorMessage(error)));
    };

    // 首次尝试才分配端口，重试沿用同一端口；拿不到端口或启动已取消时返回 false。
    const allocateKernelPort = async (startup: KernelStartup, request: KernelStartRequest,
        canceled: () => boolean): Promise<string | number | false> => {
        const {port, lang, preparedBoot} = request;
        const firstAttempt = !startup.port;
        const kernelPort = startup.port || (preparedBoot ? await preparedBoot.ready :
            startup.ownsKernel ? await getAvailablePort(port, false) : startup.devPort);
        startup.port = kernelPort;
        writeLog("got kernel port [" + kernelPort + "]");
        if (!kernelPort || canceled()) {
            return false;
        }
        if (firstAttempt && !preparedBoot) {
            showLocalBootWindow(startup.window, kernelPort, lang);
        }
        return kernelPort;
    };

    // 上一个工作空间的内核必须完全退出后才能拉起新内核，返回是否继续启动。
    const waitForWorkspaceExit = async (startup: KernelStartup, kernelPath: string, lang: string | undefined,
        canceled: () => boolean): Promise<boolean> => {
        const currentWorkspace = startup.workspace;
        const currentBootWindow = startup.window;
        let waiting = !!currentBootWindow.previousExitWaiting;
        const language = lang || languageModule.resolveAppLanguage(app.getPreferredSystemLanguages());
        const languages = languageModule.loadAppMenuLanguages(language);
        // `_kernel` 是 `appearance/langs/*.json` 里的递增数字键，96 为退出时同步失败的提示，
        // 97 为该对话框里的强制退出按钮；缺项时退回空串，不让启动流程因文案缺失中断。
        const syncFailedOnExit = languages._kernel?.[96] ?? "";
        const forceExit = languages._kernel?.[97] ?? "";
        try {
            const ready = await waitForPreviousWorkspaceExit(currentWorkspace, {
                canceled,
                watchProcess: (marker, signal) => watchWorkspaceExitProcess(kernelPath, marker, signal),
                hasActiveWindow: () => state.workspaces.some((item: Workspace) =>
                    item.workspaceDir === currentWorkspace &&
                    item.browserWindow && !item.browserWindow.isDestroyed()),
                recover: (marker, signal, force) => {
                    if (!currentWorkspace) {
                        return Promise.resolve(0);
                    }
                    return requestWorkspaceExitRecovery(currentWorkspace, marker, signal, net.fetch, undefined, force);
                },
                onRecoveryFailed: async (syncFailed: boolean) => {
                    if (canceled()) return false;
                    const {response} = await dialog.showMessageBox(currentBootWindow, {
                        type: "warning",
                        message: syncFailed ? syncFailedOnExit : (languages.previousExitWaitFailed ?? ""),
                        buttons: syncFailed ? [languages.retry ?? "", languages.cancel ?? "", forceExit] :
                            [languages.retry ?? "", languages.cancel ?? ""],
                        defaultId: 0,
                        cancelId: 1,
                    });
                    if (canceled()) return false;
                    return response === 2 && syncFailed ? "force" : response === 0;
                },
                onWaiting: async () => {
                    waiting = true;
                    writeLog("waiting for previous workspace exit");
                    currentBootWindow.previousExitWaiting = languages.previousExitWaiting;
                    await currentBootWindow.webContents.executeJavaScript(
                        `window.setPreviousExitWaiting(${JSON.stringify(languages.previousExitWaiting)})`);
                },
            });
            if (!ready || canceled()) {
                if (!canceled()) currentBootWindow.destroy();
                return false;
            }
            if (waiting) {
                currentBootWindow.previousExitWaiting = "";
                await currentBootWindow.webContents.executeJavaScript("window.setPreviousExitWaiting(\"\")");
                if (canceled()) return false;
            }
        } catch (error) {
            writeLog("wait for previous workspace exit failed: " + error);
            if (!canceled()) {
                showErrorWindow(languages.previousExitWaiting ?? "", "",
                    escapeHTML(languages.previousExitWaitFailed));
                currentBootWindow.destroy();
            }
            return false;
        }
        return true;
    };

    // 拉起内核进程并登记退出处理：进程异常退出时立即结束本次尝试。
    const startKernelProcess = (attempt: KernelAttempt, cmds: string[]): void => {
        const {startup, kernelPort} = attempt;
        const spawnStartedAt = now();
        const kernelProcess = childProcess.spawn(attempt.kernelPath, cmds, {
            detached: false, // 内核进程随主进程退出，不以游离模式运行 https://github.com/siyuan-note/siyuan/issues/6336
            stdio: "ignore",
        });
        writeLog("spawned kernel process [" + (now() - spawnStartedAt) + "ms]");
        const kernelPortKey = kernelPort.toString();
        state.kernel.exitedPorts.delete(kernelPortKey);
        state.kernel.processes.set(kernelPortKey, kernelProcess);
        startup.kernelRunning = true;
        startup.process = kernelProcess;
        writeLog("booted kernel process [pid=" + kernelProcess.pid + ", port=" + kernelPort + "]");
        kernelProcess.on("close", (code: number | null, signal: string) => {
            attempt.run.exited = true;
            if (startup.process === kernelProcess) startup.kernelRunning = false;
            if (state.kernel.processes.get(kernelPortKey) === kernelProcess) {
                state.kernel.processes.delete(kernelPortKey);
                state.kernel.exitedPorts.add(kernelPortKey);
            }
            const expectedExit = state.kernel.expectedExitPorts.delete(kernelPortKey);
            writeLog(`kernel [pid=${kernelProcess.pid}, port=${kernelPort}] exited with code [${code}], signal [${signal}], expected [${expectedExit}]`);
            if (startup.canceled) {
                attempt.settle(false);
                return;
            }
            if (code === 24 && !expectedExit && !attempt.run.started) {
                attempt.settle(attempt.canceled() ? false : "workspace-locked");
                return;
            }
            if (0 !== code && !expectedExit) {
                // 退出码到提示内容的映射由纯模块给出，这里只负责呈现。
                const report = describeKernelExit(code ?? -1, {expectedExit, port: kernelPortKey});
                let errorWindowId;
                if (report.kind === "locked") {
                    errorWindowId = showWorkspaceLocked();
                } else if (report.kind === "error") {
                    const resolvedLogPath = report.logSource === "kernel" ? path.join(paths.confDir, "kernel.log") :
                        report.logSource === "workspace" ? getWorkspaceLogPath(path, startup.workspace) : "";
                    errorWindowId = showErrorWindow(report.titleZh || "", report.titleEn || "",
                        report.content || "", {emoji: report.emoji, logPath: resolvedLogPath});
                }
                exitApp(kernelPort, errorWindowId);
                if (!startup.window.isDestroyed()) {
                    startup.window.destroy();
                }
                attempt.settle(false);
            }
        });
    };

    // 轮询内核版本接口，版本匹配时返回 true；失败时自行提示并结束本次尝试。
    const waitForKernelVersion = async (attempt: KernelAttempt): Promise<boolean> => {
        const {startup, kernelPort} = attempt;
        let count = 0;
        writeLog("checking kernel version");
        for (; ;) {
            if (settleIfCanceled(attempt)) {
                return false;
            }
            let apiData;
            try {
                apiData = await fetchLocalKernelJSON(kernelEndpoint.getServer(kernelPort) + "/api/system/version");
            } catch (e) {
                writeLog("get kernel version failed: " + errorMessage(e));
                if (settleIfCanceled(attempt)) {
                    return false;
                }
                // 本机请求超时说明端口已监听但通道不通，与防火墙拦截区分提示。
                if (exhaustedVersionAttempts(++count)) {
                    const versionTimedOut = isLocalKernelRequestTimeout(toError(e));
                    writeLog("get kernel ver failed [timeout=" + versionTimedOut + "]");
                    if (versionTimedOut) {
                        showKernelUnresponsiveWindow(attempt.request.lang);
                    } else {
                        showStaticMessage(kernelPortUnavailableMessage);
                    }
                    startup.window.destroy();
                    attempt.settle(false);
                    return false;
                }
                await sleep(VERSION_RETRY_INTERVAL_MS);
                continue;
            }
            if (settleIfCanceled(attempt)) {
                return false;
            }
            if (0 !== apiData.code) {
                writeLog(`get kernel version failed: ${apiData.code}, ${apiData.msg}`);
                attempt.settle(false);
                return false;
            }
            attempt.run.started = true;
            writeLog("got kernel version [" + apiData.data + "]");
            if (!paths.isDevEnv && apiData.data !== paths.appVer) {
                writeLog(`kernel [${apiData.data}] is running, shutdown it now and then start kernel [${paths.appVer}]`);
                startup.window.destroy();
                attempt.settle(false);
                return false;
            }
            return true;
        }
    };

    // 轮询启动进度，100% 后交回端口；超时与不可恢复的失败会关闭启动页。
    const waitForBootProgress = async (attempt: KernelAttempt): Promise<void> => {
        const {startup, kernelPort} = attempt;
        let progressFailures = 0;
        const bootShowStart = now();
        for (; ;) {
            if (settleIfCanceled(attempt)) {
                return;
            }
            if (bootTimedOut(now(), bootShowStart)) {
                writeLog("boot progress timeout after " + BOOT_TIMEOUT_MS + "ms, exiting boot");
                showStaticMessage(bootTimeoutMessage, {emoji: "⚠️", logPath: getWorkspaceLogPath(path, startup.workspace)});
                startup.window.destroy();
                attempt.settle(false);
                return;
            }
            try {
                const progressData = await fetchLocalKernelJSON(kernelEndpoint.getServer(kernelPort) + "/api/system/bootProgress");
                if (settleIfCanceled(attempt)) {
                    return;
                }
                progressFailures = 0;
                if (progressData.data.progress >= 100) {
                    // 内核完成后等待动画快进收尾再进入主窗口。
                    await sleep(BOOT_ANIMATION_SETTLE_MS);
                    attempt.settle(bootCanceled(attempt) ? false : kernelPort);
                    return;
                }
                await sleep(PROGRESS_POLL_INTERVAL_MS);
            } catch (e) {
                writeLog("get boot progress failed: " + errorMessage(e));
                if (settleIfCanceled(attempt)) {
                    return;
                }
                // 只读启动查询在证书、网络配置变化或本机请求超时后有限重试，不延长总启动期限。
                if (canRetryProgress(e, ++progressFailures)) {
                    writeLog("retrying boot progress [attempt=" + progressFailures + "/" +
                        (PROGRESS_FAILURE_LIMIT - 1) + "]");
                    await sleep(PROGRESS_RETRY_INTERVAL_MS);
                    continue;
                }
                if (isLocalKernelRequestTimeout(toError(e))) {
                    showKernelUnresponsiveWindow(attempt.request.lang);
                }
                startup.window.destroy();
                attempt.settle(false);
                return;
            }
        }
    };

    // 一次启动尝试的流程：前置检查、分配端口、等待旧内核退出、拉起进程、轮询就绪。
    const runKernelAttempt = async (startup: KernelStartup, request: KernelStartRequest,
        settle: (result: string | number | false) => void): Promise<void> => {
        const {lang} = request;
        const canceled = () => startup.canceled || startup.window.isDestroyed();
        if (!startup.port && !await showAppleSiliconWarning(lang)) {
            app.quit();
            settle(false);
            return;
        }
        const kernelName = "win32" === process.platform ? "SiYuan-Kernel.exe" : "SiYuan-Kernel";
        const kernelPath = path.join(paths.appDir, "kernel", kernelName);
        if (!fs.existsSync(kernelPath)) {
            showStaticMessage(kernelProgramMissingMessage(kernelPath));
            settle(false);
            return;
        }

        const kernelPort = await allocateKernelPort(startup, request, canceled);
        if (!kernelPort) {
            settle(false);
            return;
        }
        if (startup.ownsKernel && !await waitForWorkspaceExit(startup, kernelPath, lang, canceled)) {
            settle(false);
            return;
        }

        const attempt: KernelAttempt = {
            startup, request, settle, kernelPort, kernelPath, canceled,
            run: {exited: false, started: false},
        };
        const cmds: string[] = ["serve", "--port", kernelPort.toString(), "--wd", paths.appDir, "--attach-ui"];
        if (!startup.ownsKernel) {
            cmds.push("--mode", "dev");
        }
        if (startup.workspace && "" !== startup.workspace) {
            cmds.push("--workspace", startup.workspace);
        }
        if (request.lang && "" !== request.lang) {
            cmds.push("--lang", request.lang);
        }
        if (request.safeMode) {
            cmds.push("--safe-mode", "true");
        }
        writeLog(`ui version [${paths.appVer}], booting kernel [${kernelPath} ${cmds.join(" ")}]`);
        if (startup.ownsKernel) {
            startKernelProcess(attempt, cmds);
        }
        if (!await waitForKernelVersion(attempt)) {
            return;
        }
        await waitForBootProgress(attempt);
    };

    // 拉起内核分四步：定位工作空间 - 复用已运行窗口 - 登记启动并挂取消 - 带锁冲突重试执行。
    const initKernel: InitKernel = async (request) => {
        // port 与 safeMode 只经由 request 转交给单次尝试，这里只取回退逻辑与重试提示需要的字段。
        const {workspace, lang, preparedBoot} = request;
        // 命令行、SIYUAN_WORKSPACE_PATH 与上次工作空间依次回退，三者都没有时无法确定工作空间。
        const targetWorkspace = [workspace, process.env.SIYUAN_WORKSPACE_PATH, state.startup.lastWorkspacePath]
            .find((item): item is string => typeof item === "string" && item !== "");
        if (!targetWorkspace) {
            writeLog("no workspace to start the kernel for");
            return undefined;
        }
        // 同一工作空间已有启动记录或主窗口时直接显示，不重复拉起内核。
        const key = previousKernelExit.getWorkspaceStartupKey(targetWorkspace);
        const existingStartup = state.kernel.startups.get(key);
        const openedWindow = state.workspaces.find((item: Workspace) =>
            item.workspaceDir && previousKernelExit.getWorkspaceStartupKey(item.workspaceDir) === key &&
            item.browserWindow && !item.browserWindow.isDestroyed());
        const runningWindow = existingStartup?.window ?? openedWindow?.browserWindow;
        if (runningWindow) {
            showWindow(runningWindow);
            return undefined;
        }
        const startup = createKernelStartup(targetWorkspace, preparedBoot);
        state.kernel.startups.set(key, startup);
        const cancelStartup = createStartupCanceller(startup);
        app.on("before-quit", cancelStartup);
        let started = false;
        try {
            const result = await runStartupWithLockRetry(startup, request, {
                canceled: () => startup.canceled || startup.window.isDestroyed(),
                notifyWaiting: () => showLockWaiting(startup, lang),
                failLocked: () => failLockedStartup(startup),
            });
            // 失败统一以 undefined 结束，调用方只按真值判断是否启动成功。
            started = !!result;
            return result === false ? undefined : result;
        } finally {
            app.removeListener("before-quit", cancelStartup);
            if (!started) {
                cancelStartup();
                state.kernel.startups.delete(key);
            }
        }
    };

    // 启动页与启动记录必须在首次异步等待前就位，否则会重复启动或因为没有窗口而退出应用。
    const createKernelStartup = (targetWorkspace: string,
        preparedBoot: KernelStartRequest["preparedBoot"]): KernelStartup => ({
        workspace: targetWorkspace,
        window: preparedBoot ? preparedBoot.window : createBootWindow(),
        ownsKernel: !paths.isDevEnv || state.workspaces.length > 0 || state.kernel.startups.size > 0,
        devPort: state.kernel.port,
    });

    // 退出时中止本次启动：请求内核退出并关闭启动页，避免留下无法继续的等待窗口。
    const createStartupCanceller = (startup: KernelStartup): (() => void) => () => {
        startup.canceled = true;
        const startupPort = startup.port;
        if (startup.kernelRunning && !startup.exitRequested && startupPort !== undefined) {
            startup.exitRequested = true;
            state.kernel.expectedExitPorts.add(startupPort.toString());
            requestKernelExit(startupPort, {setCurrentWorkspace: false});
        }
        if (!startup.window.isDestroyed()) {
            startup.window.destroy();
        }
    };

    // 锁冲突等待期间把提示写到启动页上。
    const showLockWaiting = async (startup: KernelStartup, lang: string | undefined): Promise<void> => {
        const languages = languageModule.loadAppMenuLanguages(
            lang || languageModule.resolveAppLanguage(app.getPreferredSystemLanguages()));
        startup.window.previousExitWaiting = languages.workspaceLockWaiting;
        await startup.window.webContents.executeJavaScript(
            `window.setPreviousExitWaiting(${JSON.stringify(languages.workspaceLockWaiting)})`);
        writeLog("workspace is locked, waiting to retry kernel startup");
    };

    // 锁冲突重试已用尽：给出「工作空间被占用」窗口并结束本次启动。
    const failLockedStartup = (startup: KernelStartup): false => {
        const startupPort = startup.port;
        if (startupPort !== undefined) {
            exitApp(startupPort, showWorkspaceLocked());
        }
        if (!startup.window.isDestroyed()) {
            startup.window.destroy();
        }
        return false;
    };

    // 锁冲突时按固定节奏重试，直到成功、被取消或期限用尽。
    // 期限只覆盖锁冲突；正常退出的同步恢复另有 kernel 侧的等待期限。
    const runStartupWithLockRetry = async (startup: KernelStartup, request: KernelStartRequest, {
        canceled, notifyWaiting, failLocked,
    }: {
        canceled: () => boolean;
        notifyWaiting: () => Promise<void>;
        failLocked: () => false;
    }): Promise<string | number | false> => {
        let retryDeadline: number | undefined;
        for (; ;) {
            const result = await initKernelAttempt(startup, request, runKernelAttempt, writeLog);
            if (result !== "workspace-locked") {
                return result;
            }
            if (canceled()) {
                return false;
            }
            retryDeadline ??= now() + LOCK_RETRY_DEADLINE_MS;
            if (lockRetryExpired(now(), retryDeadline)) {
                return failLocked();
            }
            const outcome = await waitForWorkspaceLockRelease({
                now, sleep, deadline: retryDeadline, canceled, notify: notifyWaiting,
            });
            if (outcome.kind === "notify-failed") {
                writeLog("wait to retry kernel startup failed: " + outcome.error);
                return canceled() ? false : failLocked();
            }
            if (outcome.kind === "canceled") {
                return false;
            }
            if (outcome.kind === "expired") {
                return failLocked();
            }
        }
    };

    return {
        initKernel,
        showKernelUnresponsiveWindow,
    };
};

export {createKernelBoot};
