const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const linuxInputMethodRelaunchEnvironment = "SIYUAN_LINUX_INPUT_METHOD_RELAUNCH";
const linuxInputMethodRelaunchSwitch = "--siyuan-linux-input-method-relaunch=";

const readLinuxInputMethodSetting = (file) => {
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        if (typeof data?.enabled !== "boolean") {
            throw new Error("Invalid Linux input method setting");
        }
        return data.enabled;
    } catch (error) {
        if (error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
};

const writeLinuxInputMethodSetting = (file, enabled) => {
    if (typeof enabled !== "boolean") {
        throw new TypeError("Invalid Linux input method setting");
    }
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temporary = file + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
    try {
        fs.writeFileSync(temporary, JSON.stringify({enabled}), {mode: 0o600});
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) {
            fs.unlinkSync(temporary);
        }
    }
};

// Electron 保留原始启动参数快照，不包含 Chromium 后续补入的开关。
// 复制快照，避免进程标题改写命令行或后续参数修改影响启动判定。
const readLinuxInputMethodArguments = (args = process.argv) => {
    if (!Array.isArray(args) || args.length === 0 || args.some(arg => typeof arg !== "string")) {
        throw new Error("Invalid Linux launch arguments");
    }
    return args.slice();
};

// 显式显示后端参数优先于本机兼容设置，重复参数采用最后一次指定的值。
const getLinuxInputMethodBackend = (args) => {
    let backend = null;
    for (let i = 1; i < args.length && args[i] !== "--"; i++) {
        if (args[i].startsWith("--ozone-platform=")) {
            backend = args[i].slice("--ozone-platform=".length);
        } else if (args[i] === "--ozone-platform") {
            backend = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "";
        }
    }
    return backend;
};

const getLinuxInputMethodOverride = (args) => {
    const backend = getLinuxInputMethodBackend(args);
    return backend === null ? null : backend === "x11";
};

// 原生后端在应用脚本加载前选定，通过重启把兼容参数交给下一进程的原生启动阶段。
// 随机标记仅在进程环境中传递，用于区分本机设置生成的参数和用户显式参数。
const prepareLinuxInputMethodLaunch = (args, enabled, platform, relaunchToken) => {
    const original = args.slice();
    const result = {args: original, override: null, relaunchArgs: null, relaunchToken: null};
    if (platform !== "linux") {
        return result;
    }
    let managed = false;
    if (/^[a-f0-9]{48}$/.test(relaunchToken || "")) {
        for (let i = 2; i < original.length && original[i] !== "--"; i++) {
            if (original[i] === linuxInputMethodRelaunchSwitch + relaunchToken &&
                original[i - 1] === "--ozone-platform=x11") {
                original.splice(i - 1, 2);
                managed = true;
                break;
            }
        }
    }
    const backend = getLinuxInputMethodBackend(original);
    result.override = getLinuxInputMethodOverride(original);
    if (backend !== null) {
        if (managed && getLinuxInputMethodBackend(args) !== backend) {
            result.relaunchArgs = original.slice(1);
        }
        return result;
    }
    if (enabled && !managed) {
        const next = original.slice();
        const terminator = next.indexOf("--", 1);
        result.relaunchToken = crypto.randomBytes(24).toString("hex");
        next.splice(terminator < 0 ? next.length : terminator, 0,
            "--ozone-platform=x11", linuxInputMethodRelaunchSwitch + result.relaunchToken);
        result.relaunchArgs = next.slice(1);
    } else if (!enabled && managed) {
        result.relaunchArgs = original.slice(1);
    }
    return result;
};

module.exports = {
    readLinuxInputMethodSetting, writeLinuxInputMethodSetting, readLinuxInputMethodArguments,
    getLinuxInputMethodOverride, prepareLinuxInputMethodLaunch, linuxInputMethodRelaunchEnvironment,
};
