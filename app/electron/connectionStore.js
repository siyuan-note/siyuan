const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {normalizeRemoteKernelOrigin, getUnsafeRemoteChromiumSwitchName} = require("./remoteKernel");

const remotePartition = (origin) => "persist:siyuan-remote-" +
    crypto.createHash("sha256").update(normalizeRemoteKernelOrigin(origin)).digest("hex");

// 只保留地址记录，会话凭据由 Electron 会话存储管理。
const readConnections = (file) => {
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        if (data.version !== 1 || !Array.isArray(data.origins) ||
            (data.migrated !== undefined && !Array.isArray(data.migrated))) {
            throw new Error("Unsupported connection history");
        }
        return {...data, origins: [...new Set(data.origins.map(normalizeRemoteKernelOrigin))],
            migrated: (data.migrated || []).map(normalizeRemoteKernelOrigin)};
    } catch (error) {
        if (error.code === "ENOENT") {
            return {version: 1, origins: [], migrated: []};
        }
        throw error;
    }
};

const writeConnections = (file, data) => {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temporary = file + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
    try {
        fs.writeFileSync(temporary, JSON.stringify(data, null, 2), {mode: 0o600});
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) {
            fs.unlinkSync(temporary);
        }
    }
};

// 切换时移除目标相关参数，避免把本地安全开关或远程扩展信任带到另一个连接。
const connectionArgs = (args, target, currentOrigin) => {
    const removed = new Set(["--remote", "--workspace", "--port", "--safe-mode", "--openAsHidden",
        "--trust-remote-extensions", "--no-proxy-server", "--connection-session"]);
    const result = args.filter(arg => !removed.has(arg.split("=", 1)[0]) &&
        !arg.startsWith("siyuan://") && !getUnsafeRemoteChromiumSwitchName(arg));
    if (target.mode === "remote") {
        const origin = normalizeRemoteKernelOrigin(target.origin);
        result.push("--remote=" + origin);
        if (/^[a-f0-9]{48}$/.test(target.sessionHandoff || "")) {
            result.push("--connection-session=" + target.sessionHandoff);
        }
        if (origin === currentOrigin && args.includes("--trust-remote-extensions")) {
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
const closeConnectionWindows = (windows) => Promise.all(windows.map(window => new Promise(resolve => {
    if (window.isDestroyed()) {
        resolve();
        return;
    }
    window.once("closed", resolve);
    window.close();
})));

module.exports = {connectionArgs, readConnections, writeConnections, remotePartition, closeConnectionWindows};
