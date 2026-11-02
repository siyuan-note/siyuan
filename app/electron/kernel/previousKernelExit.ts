// 上一次内核进程的退出等待与恢复：读取退出标记、观察进程结束，并在同步失败时提供重试或强制退出。
import * as fs from "node:fs";
import * as path from "node:path";
import * as nodeChildProcess from "node:child_process";
import * as timing from "../shared/timing";
import {getServer} from "./kernelEndpoint";

// 工作空间启动登记的键：先解析为绝对路径，Windows 下再统一为小写，
// 让同一目录的不同写法命中同一次启动。
const getWorkspaceStartupKey = (workspace: string): string => {
    const resolved = path.resolve(workspace);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

const exitMarkerPath = (workspace: string): string => path.join(workspace, "temp", "kernel-exit.json");

type ExitMarker = {
    version: number;
    pid: number;
    startedAt: number;
    processStartedAt?: number;
    port?: string;
    phase?: string;
};

type ExitRecoveryResult = {code: number};

type ExitFetch = (url: string, init: {
    method: "POST";
    headers: Record<string, string>;
    signal?: AbortSignal;
    credentials: "omit" | "include";
    redirect: "error";
    body: string;
}) => Promise<{ok: boolean; json: () => Promise<ExitRecoveryResult>}>;

type RecoveryResult = {code?: number; startedAt?: number; error?: boolean};

const exitWaitTimeout = 10 * 60 * 1000;

const validMarker = (marker: ExitMarker | undefined, now: number): boolean => !!marker && [1, 2].includes(marker.version) &&
    Number.isSafeInteger(marker.pid) && marker.pid > 0 && Number.isSafeInteger(marker.startedAt) &&
    marker.startedAt > 0 && marker.startedAt <= now &&
    (marker.processStartedAt === undefined || (Number.isSafeInteger(marker.processStartedAt) && marker.processStartedAt > 0)) &&
    (marker.version === 2 || now - marker.startedAt <= exitWaitTimeout);

type ExitProcessRunner = (file: string, args: string[], options: {windowsHide: boolean; signal: AbortSignal},
    callback: (error: Error | null) => void) => void;

// 观察子命令不初始化工作空间；成功表示原进程已结束或 PID 已被复用。身份参数以 argv 传递，不经过 shell，
// 观察失败时中断启动而不是继续等待旧进程。
const watchWorkspaceExitProcess = (kernelPath: string, marker: {
    pid: number; startedAt: number; processStartedAt?: number;
}, signal: AbortSignal,
    execute: ExitProcessRunner = nodeChildProcess.execFile): Promise<void> => new Promise((resolve, reject) => {
    execute(kernelPath, ["workspace", "wait-exit", "--pid", String(marker.pid),
        "--started-at", String(marker.startedAt), "--process-started-at", String(marker.processStartedAt || 0)],
    {windowsHide: true, signal}, error => error ? reject(error) : resolve());
});

// 认证材料只发送到标记中的本机端口；内核还会核对进程、退出批次及活动会话。
const requestWorkspaceExitRecovery = async (workspace: string, marker: ExitMarker, signal: AbortSignal,
    fetch: ExitFetch,
    readFile: (file: string, encoding: BufferEncoding) => string = fs.readFileSync,
    force = false): Promise<number> => {
    if (marker.version !== 2 || !/^\d{1,5}$/.test(marker.port as string) || Number(marker.port) < 1 || Number(marker.port) > 65535) {
        throw new Error("Invalid workspace exit port");
    }
    const config = JSON.parse(readFile(path.join(workspace, "conf", "conf.json"), "utf8"));
    const headers: Record<string, string> = {"Content-Type": "application/json"};
    if (config.api?.token) {
        headers.Authorization = "Token " + config.api.token;
    } else if (config.accessAuthCode) {
        headers.Authorization = "Basic " + Buffer.from(path.basename(workspace) + ":" + config.accessAuthCode).toString("base64");
    }
    const response = await fetch(getServer(marker.port as string) + "/api/system/exit", {
        method: "POST", headers, signal, credentials: headers.Authorization ? "omit" : "include", redirect: "error",
        body: JSON.stringify({recoverExit: {pid: marker.pid, startedAt: marker.startedAt, ...(force ? {force: true} : {})}}),
    });
    if (!response.ok) {
        throw new Error("Workspace exit recovery request rejected");
    }
    const result = await response.json();
    if (![0, 1, 3].includes(result.code)) {
        throw new Error("Workspace exit recovery no longer matches");
    }
    return result.code;
};

const isProcessAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // 无权查询不能视作进程已经退出。
        if ((error as NodeJS.ErrnoException).code === "EPERM") {
            return true;
        }
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
            return false;
        }
        throw error;
    }
};

const waitForPreviousWorkspaceExit = async (workspace: string | undefined, {
    canceled,
    onWaiting,
    recover,
    hasActiveWindow = () => false,
    onRecoveryFailed = async () => false,
    readFile = (file: string) => fs.readFileSync(file, "utf8"),
    alive = isProcessAlive,
    watchProcess,
    now = Date.now,
    sleep = timing.sleep,
}: {
    canceled: () => boolean;
    onWaiting: () => Promise<void>;
    /** 观察进程身份；成功表示原进程已结束或 PID 已被复用。 */
    watchProcess: (marker: ExitMarker, signal: AbortSignal) => Promise<unknown>;
    recover?: (marker: ExitMarker, signal: AbortSignal, forced: boolean) => Promise<number>;
    hasActiveWindow?: () => boolean;
    onRecoveryFailed?: (forced: boolean) => Promise<boolean | "force">;
    readFile?: (file: string) => string;
    alive?: (pid: number) => boolean;
    now?: () => number;
    sleep?: (ms: number) => Promise<unknown>;
}): Promise<boolean> => {
    if (!workspace || canceled()) {
        return !canceled();
    }
    let marker: ExitMarker;
    try {
        marker = JSON.parse(readFile(exitMarkerPath(workspace)));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
            return true;
        }
        throw error;
    }
    // 旧版、损坏或过期的状态不作为等待依据，继续由内核检查工作空间锁。
    let started = now();
    if (!validMarker(marker, started) || !alive(marker.pid)) {
        return true;
    }
    await onWaiting();
    const controller = new AbortController();
    let ownerExited = false;
    let inspectionError: unknown;
    let pending: Promise<void> | undefined;
    let result: RecoveryResult | undefined;
    let nextRecovery = now() + 1000;
    let completedBatch: number | undefined;
    let forcedBatch: number | undefined;
    try {
        Promise.resolve().then(() => watchProcess(marker, controller.signal)).then(() => {
            ownerExited = true;
        }, error => { inspectionError = error; });
        // 持续读取同一进程的退出阶段，接管无人处置的更新确认与同步失败。
        while (!ownerExited && alive(marker.pid)) {
            if (inspectionError) throw inspectionError;
            if (canceled()) {
                return false;
            }
            if (now() - started >= exitWaitTimeout) {
                throw new Error("Previous workspace exit timed out");
            }
            if (result) {
                const finished = result;
                result = undefined;
                pending = undefined;
                nextRecovery = now() + 1000;
                if (finished.code === 0) {
                    completedBatch = finished.startedAt;
                } else if (finished.error || finished.code === 1) {
                    const action = await onRecoveryFailed(finished.code === 1);
                    if (!action) {
                        return false;
                    }
                    forcedBatch = action === "force" && finished.code === 1 ? finished.startedAt : undefined;
                    started = now();
                }
            }
            if (!pending && recover && !hasActiveWindow() && now() >= nextRecovery) {
                let current: ExitMarker | undefined;
                try {
                    current = JSON.parse(readFile(exitMarkerPath(workspace)));
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                }
                if (current && (!validMarker(current, now()) || current.pid !== marker.pid ||
                    (marker.processStartedAt && current.processStartedAt !== marker.processStartedAt))) {
                    throw new Error("Workspace exit owner changed");
                }
                if (current?.version === 2 && current.phase === "waiting" && current.startedAt !== completedBatch &&
                    !canceled() && alive(marker.pid)) {
                    const recoverRequest = recover;
                    const batchStartedAt = current.startedAt;
                    pending = Promise.resolve().then(() => recoverRequest(current as ExitMarker, controller.signal,
                        batchStartedAt === forcedBatch)).then((code: number) => {
                        result = {code, startedAt: batchStartedAt};
                    }, () => { result = {error: true}; });
                }
            }
            await sleep(200);
        }
        return !canceled();
    } finally {
        controller.abort();
    }
};

export {getWorkspaceStartupKey, requestWorkspaceExitRecovery, waitForPreviousWorkspaceExit, watchWorkspaceExitProcess};
