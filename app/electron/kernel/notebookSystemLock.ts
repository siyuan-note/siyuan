import * as fs from "node:fs/promises";
import * as path from "node:path";
import {net} from "electron";
import {state, writeLog as defaultWriteLog} from "../shared/runtime";
import {requestFromWindows} from "../shared/windowRoundTrip";
import type {BrowserWindow} from "electron";
import type {LogFunction, Workspace} from "../shared/types";
import {Channel} from "../shared/channels";

type NotebookSystemLockResponse = {ok: boolean; json: () => Promise<{code: number}>};

type NotebookSystemLockRequest = {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    credentials: "omit" | "include";
    redirect: "error";
    signal: AbortSignal;
};

type NotebookSystemLock = {
    lock: () => Promise<void[]>;
    retry: () => Promise<void>;
};

// 主进程直接请求本地内核，优先使用配置中的认证材料；仅会话认证时使用本地窗口的会话。
const createNotebookSystemLock = ({
    getWorkspaces = () => state.workspaces,
    fetch = (url, init) => net.fetch(url, init),
    writeLog = defaultWriteLog,
    prepare = async () => {}, readFile = fs.readFile}: {
        getWorkspaces?: () => Workspace[];
        fetch?: (url: string, init: NotebookSystemLockRequest) => Promise<NotebookSystemLockResponse>;
        writeLog?: LogFunction;
        prepare?: (workspace: Workspace) => Promise<void>;
        readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
    }): NotebookSystemLock => {
    const pending = new Map<string, Workspace>();
    const running = new Map<string, Promise<void>>();
    const request = (workspace: Workspace): Promise<void> => {
        const origin = workspace.kernelTarget.origin;
        if (running.has(origin)) {
            return running.get(origin) as Promise<void>;
        }
        pending.set(origin, workspace);
        const task = (async (): Promise<void> => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const config = JSON.parse(await readFile(path.join(workspace.workspaceDir as string, "conf", "conf.json"), "utf8"));
                if (!config.system?.encryptedNotebookFollowSystemLock) {
                    pending.delete(origin);
                    return;
                }
                try {
                    await prepare(workspace);
                } catch {
                    writeLog("encrypted notebook editor preparation failed; continue system lock");
                }
                const headers: Record<string, string> = {"Content-Type": "application/json"};
                if (config.api?.token) {
                    headers.Authorization = "Token " + config.api.token;
                } else if (config.accessAuthCode) {
                    headers.Authorization = "Basic " + Buffer.from(path.basename(workspace.workspaceDir as string) + ":" + config.accessAuthCode).toString("base64");
                }
                const response = await fetch(origin + "/api/notebook/lockEncryptedNotebooksOnSystemLock", {
                    method: "POST",
                    headers,
                    body: "{}",
                    credentials: headers.Authorization ? "omit" : "include",
                    redirect: "error",
                    signal: controller.signal,
                });
                if (!response.ok || (await response.json()).code !== 0) {
                    throw new Error("request rejected");
                }
                pending.delete(origin);
            } catch {
                // 不记录异常原文，避免请求和配置中的认证信息进入日志。
                writeLog("encrypted notebook system lock failed; retry on system unlock or resume");
            } finally {
                clearTimeout(timeout);
                running.delete(origin);
            }
        })();
        running.set(origin, task);
        return task;
    };
    const localWorkspaces = (): Workspace[] => getWorkspaces().filter((workspace: Workspace) =>
        workspace.ownsKernel && workspace.workspaceDir && workspace.kernelTarget?.origin);
    return {
        lock: () => Promise.all(localWorkspaces().map(request)),
        retry: async (): Promise<void> => {
            // 系统可能在请求完成前休眠；恢复后等待在途请求，再重试未成功的本地工作空间。
            await Promise.all(running.values());
            const workspaces = localWorkspaces();
            for (const origin of pending.keys()) {
                if (!workspaces.some((workspace: Workspace) => workspace.kernelTarget.origin === origin)) {
                    pending.delete(origin);
                }
            }
            await Promise.all(workspaces.filter((workspace: Workspace) => pending.has(workspace.kernelTarget.origin)).map(request));
        },
    };
};

// 等待各窗口提交输入，但不让无响应窗口无限阻止内核锁定。
// 某个窗口发送失败只放弃该窗口：锁屏不应因一个窗口异常而跳过其余编辑器的提交。
const prepareNotebookSystemLock = (windows: BrowserWindow[]): Promise<void> =>
    requestFromWindows({
        windows,
        channel: Channel.SIYUAN_NOTEBOOK_SYSTEM_LOCK_READY,
        command: "prepareNotebookSystemLock",
        timeoutMs: 1000,
        // 该回执以位置参数携带请求序号。
        readRequestID: payload => typeof payload === "number" ? payload : undefined,
        skipFailedPeer: true,
    }).then(() => undefined);

export {createNotebookSystemLock, prepareNotebookSystemLock};
export type {NotebookSystemLock};
