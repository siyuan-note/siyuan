const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

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

// 读取内核保存的启动参数，排除 Chromium 和本机设置在进程内追加的参数。
const readLinuxInputMethodArguments = () => {
    const content = fs.readFileSync("/proc/self/cmdline", "utf8");
    if (!content || !content.endsWith("\0")) {
        throw new Error("Invalid Linux process command line");
    }
    return content.slice(0, -1).split("\0");
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

const configureLinuxInputMethod = (commandLine, enabled, platform, args) => {
    if (platform !== "linux") {
        return;
    }
    const backend = getLinuxInputMethodBackend(args);
    if (backend !== null || enabled) {
        commandLine.appendSwitch("ozone-platform", backend ?? "x11");
    }
};

module.exports = {
    readLinuxInputMethodSetting, writeLinuxInputMethodSetting, readLinuxInputMethodArguments,
    getLinuxInputMethodOverride, configureLinuxInputMethod,
};
