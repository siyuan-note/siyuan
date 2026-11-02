import * as fs from "node:fs";
import * as path from "node:path";
import {randomUUID} from "node:crypto";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";

type RemoteExportTarget = {url: string; name: string};

// 直接沿用 DOM 的 Response 形状，fetch 的返回值才能原样传入而无需断言。
type RemoteExportResponse = Pick<Response, "ok" | "body" | "headers">;

type RemoteExportResult = {status: "canceled"} | {status: "success"; name: string};

// 同一窗口同时只允许一个导出下载，避免重复弹窗相互覆盖临时文件。
const activeExportSenders = new WeakSet<object>();

const INVALID_EXPORT_URL = "Invalid export URL";
const INVALID_EXPORT_PATH = "Invalid export path";

const beginRemoteExport = (sender: object): boolean => {
    if (activeExportSenders.has(sender)) {
        return false;
    }
    activeExportSenders.add(sender);
    return true;
};

const endRemoteExport = (sender: object): void => {
    activeExportSenders.delete(sender);
};

const resolveRemoteExportURL = (uri: string, origin: string): RemoteExportTarget => {
    if (typeof uri !== "string" || uri.includes("\\")) {
        throw new Error(INVALID_EXPORT_URL);
    }
    const url = new URL(uri, origin + "/");
    if (url.origin !== origin || url.username || url.password || url.search || url.hash ||
        !url.pathname.startsWith("/export/") || url.pathname.startsWith("/export/temp/")) {
        throw new Error(INVALID_EXPORT_URL);
    }
    const segments = url.pathname.split("/").slice(2).map((segment: string) => {
        let decoded = segment;
        for (let count = 0; count < 8; count++) {
            if (!decoded || decoded === "." || decoded === ".." || /[\\/]/.test(decoded) ||
                Array.from(decoded).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
                throw new Error(INVALID_EXPORT_PATH);
            }
            let next: string;
            try {
                next = decodeURIComponent(decoded);
            } catch (error) {
                return decoded;
            }
            if (next === decoded) {
                return decoded;
            }
            decoded = next;
        }
        throw new Error("Invalid export encoding");
    });
    if (segments[0] === "temp") {
        throw new Error(INVALID_EXPORT_PATH);
    }
    // 文件名仅作为保存对话框的建议值，不接受服务器提供的本机目录。
    const name = segments[segments.length - 1].replace(/[<>:"|?*]/g, "_");
    return {url: url.href, name};
};

const saveRemoteExport = async ({uri, origin, choosePath, fetch, signal}: {
    uri: string;
    origin: string;
    choosePath: (name: string) => Promise<{canceled?: boolean; filePath?: string}>;
    fetch: (url: string, init: {
        credentials: "include";
        redirect: "manual";
        bypassCustomProtocolHandlers: boolean;
        signal?: AbortSignal;
    }) => Promise<RemoteExportResponse>;
    signal?: AbortSignal;
}): Promise<RemoteExportResult> => {
    const {url, name} = resolveRemoteExportURL(uri, origin);
    const result = await choosePath(name);
    if (result.canceled || !result.filePath) {
        return {status: "canceled"};
    }
    // 使用当前连接的会话下载附件，不跟随登录页或其他重定向。
    const response = await fetch(url, {
        credentials: "include", redirect: "manual", bypassCustomProtocolHandlers: true, signal,
    });
    if (!response.ok || !response.body || !/^attachment(?:;|$)/i.test(response.headers.get("content-disposition") || "")) {
        await response.body?.cancel();
        throw new Error("Export download failed");
    }
    const filePath = result.filePath;
    const temporaryPath = path.join(path.dirname(filePath), ".siyuan-export-" + randomUUID() + ".tmp");
    try {
        // 下载完成后再替换目标，失败时保留用户已有的文件。
        // DOM 与 node:stream/web 各有一套 ReadableStream 声明，运行时是同一个对象。
        await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
            fs.createWriteStream(temporaryPath, {flags: "wx", mode: 0o600}), {signal});
        await fs.promises.rename(temporaryPath, filePath);
    } finally {
        await fs.promises.rm(temporaryPath, {force: true});
    }
    return {status: "success", name: path.basename(filePath)};
};

export {resolveRemoteExportURL, saveRemoteExport, beginRemoteExport, endRemoteExport};
