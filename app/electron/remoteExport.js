const fs = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");
const {Readable} = require("node:stream");
const {pipeline} = require("node:stream/promises");

const resolveRemoteExportURL = (uri, origin) => {
    if (typeof uri !== "string" || uri.includes("\\")) {
        throw new Error("Invalid export URL");
    }
    const url = new URL(uri, origin + "/");
    if (url.origin !== origin || url.username || url.password || url.search || url.hash ||
        !url.pathname.startsWith("/export/") || url.pathname.startsWith("/export/temp/")) {
        throw new Error("Invalid export URL");
    }
    const segments = url.pathname.split("/").slice(2).map(segment => {
        let decoded = segment;
        for (let count = 0; count < 8; count++) {
            if (!decoded || decoded === "." || decoded === ".." || /[\\/]/.test(decoded) ||
                Array.from(decoded).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
                throw new Error("Invalid export path");
            }
            let next;
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
        throw new Error("Invalid export path");
    }
    // 文件名仅作为保存对话框的建议值，不接受服务器提供的本机目录。
    const name = segments[segments.length - 1].replace(/[<>:"|?*]/g, "_");
    return {url: url.href, name};
};

const saveRemoteExport = async ({uri, origin, choosePath, fetch, signal}) => {
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
    const temporaryPath = path.join(path.dirname(result.filePath), ".siyuan-export-" + randomUUID() + ".tmp");
    try {
        // 下载完成后再替换目标，失败时保留用户已有的文件。
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporaryPath, {flags: "wx", mode: 0o600}), {signal});
        await fs.promises.rename(temporaryPath, result.filePath);
    } finally {
        await fs.promises.rm(temporaryPath, {force: true});
    }
    return {status: "success", name: path.basename(result.filePath)};
};

module.exports = {resolveRemoteExportURL, saveRemoteExport};
