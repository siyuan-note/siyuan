const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const readAccessibilitySetting = (file) => {
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        if (typeof data?.enabled !== "boolean") {
            throw new Error("Invalid accessibility setting");
        }
        return data.enabled;
    } catch (error) {
        if (error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
};

const writeAccessibilitySetting = (file, enabled) => {
    if (typeof enabled !== "boolean") {
        throw new TypeError("Invalid accessibility setting");
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

// 显式启动参数优先于设置，同时指定两个参数时遵循 Chromium 的禁用优先规则。
const getAccessibilityOverride = (commandLine) => {
    if (commandLine.hasSwitch("disable-renderer-accessibility")) {
        return false;
    }
    if (commandLine.hasSwitch("force-renderer-accessibility")) {
        return true;
    }
    return null;
};

const configureAccessibility = (commandLine, enabled) => {
    if (!enabled && getAccessibilityOverride(commandLine) === null) {
        commandLine.appendSwitch("disable-renderer-accessibility");
    }
};

module.exports = {readAccessibilitySetting, writeAccessibilitySetting, getAccessibilityOverride, configureAccessibility};
