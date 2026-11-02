import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {normalizeRemoteKernelOrigin, getUnsafeRemoteChromiumSwitchName} from "./remoteKernel";
import {isDroppedOnConnectionSwitch} from "../shared/builtinArgs";
import {writeJsonAtomically} from "../shared/atomicJsonFile";
import type {BrowserWindow} from "electron";

type ConnectionHistory = {
    version: number;
    origins: string[];
    migrated: string[];
    trustedOrigins: string[];
    [key: string]: unknown;
};

const remotePartition = (origin: string): string => "persist:siyuan-remote-" +
    crypto.createHash("sha256").update(normalizeRemoteKernelOrigin(origin)).digest("hex");

// 保存地址和逐地址信任选项，会话凭据由 Electron 会话存储管理。
const readConnections = (file: string): ConnectionHistory => {
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        if (data.version !== 1 || !Array.isArray(data.origins) ||
            (data.migrated !== undefined && !Array.isArray(data.migrated)) ||
            (data.trustedOrigins !== undefined && !Array.isArray(data.trustedOrigins))) {
            throw new Error("Unsupported connection history");
        }
        const origins: string[] = [...new Set<string>(data.origins.map((origin: string) =>
            normalizeRemoteKernelOrigin(origin)))];
        return {...data, origins,
            migrated: (data.migrated || []).map((origin: string) => normalizeRemoteKernelOrigin(origin)),
            trustedOrigins: [...new Set<string>((data.trustedOrigins || []).map((origin: string) =>
                normalizeRemoteKernelOrigin(origin)))]
                .filter(origin => origins.includes(origin))};
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return {version: 1, origins: [], migrated: [], trustedOrigins: []};
        }
        throw error;
    }
};

const writeConnections = (file: string, data: ConnectionHistory): void => writeJsonAtomically(file, data, 2);

// 切换时移除内置参数与目标无关的参数，避免把本地安全开关或远程扩展信任带到另一个连接。
// 语言由目标连接重新给出，因此不在丢弃范围内。
const connectionArgs = (args: string[], target: {
    mode: string;
    origin?: string;
    path?: string;
    sessionHandoff?: string;
    trustRemoteExtensions?: boolean;
    lang?: string;
}, currentOrigin: string): string[] => {
    const result = args.filter(arg => !isDroppedOnConnectionSwitch(arg) &&
        !getUnsafeRemoteChromiumSwitchName(arg));
    if (target.mode === "remote") {
        const origin = normalizeRemoteKernelOrigin(target.origin as string);
        result.push("--remote=" + origin);
        if (/^[a-f0-9]{48}$/.test(target.sessionHandoff || "")) {
            result.push("--connection-session=" + target.sessionHandoff);
        }
        if (target.trustRemoteExtensions === true || (target.trustRemoteExtensions === undefined &&
            origin === currentOrigin && args.includes("--trust-remote-extensions"))) {
            result.push("--trust-remote-extensions");
        }
    } else if (target.mode === "local") {
        if (target.path) {
            if (!path.isAbsolute(target.path)) {
                throw new Error("Invalid workspace path");
            }
            result.push("--workspace=" + target.path);
        }
    } else {
        throw new Error("Invalid connection type");
    }
    if (/^[a-z]{2}(?:-[A-Z]{2})?$/.test(target.lang || "")) {
        return [...result.filter(arg => !arg.startsWith("--lang=")), "--lang=" + target.lang];
    }
    return result;
};

// 独立窗口先完成自己的保存与关闭流程，再退出工作空间主窗口。
const closeConnectionWindows = (windows: BrowserWindow[]): Promise<void[]> =>
    Promise.all(windows.map((window: BrowserWindow) => new Promise<void>(resolve => {
        if (window.isDestroyed()) {
            resolve();
            return;
        }
        window.once("closed", resolve);
        window.close();
    })));

export {connectionArgs, readConnections, writeConnections, remotePartition, closeConnectionWindows};
