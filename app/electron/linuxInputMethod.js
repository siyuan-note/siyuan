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

// 显式显示后端参数优先于本机兼容设置。
const getLinuxInputMethodOverride = (commandLine) => {
    if (commandLine.hasSwitch("ozone-platform")) {
        return commandLine.getSwitchValue("ozone-platform") === "x11";
    }
    return null;
};

const configureLinuxInputMethod = (commandLine, enabled, platform) => {
    if (platform === "linux" && enabled && getLinuxInputMethodOverride(commandLine) === null) {
        commandLine.appendSwitch("ozone-platform", "x11");
    }
};

module.exports = {readLinuxInputMethodSetting, writeLinuxInputMethodSetting, getLinuxInputMethodOverride, configureLinuxInputMethod};
