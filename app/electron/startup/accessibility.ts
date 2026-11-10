import {app} from "electron";
import {errorMessage} from "../shared/errors";
import {writeLog} from "../shared/runtime";
import {readEnabledSetting, writeEnabledSetting} from "./enabledSettingFile";

// 辅助功能开关与启动参数覆盖同属一份本机设置，状态由本模块持有。
let accessibilityEnabled = true;
let accessibilityOverride: boolean | null = null;

// 显式启动参数优先于设置，同时指定两个参数时遵循 Chromium 的禁用优先规则。
const getAccessibilityOverride = (): boolean | null => {
    const {commandLine} = app;
    if (commandLine.hasSwitch("disable-renderer-accessibility")) {
        return false;
    }
    if (commandLine.hasSwitch("force-renderer-accessibility")) {
        return true;
    }
    return null;
};

const configureAccessibility = (enabled: boolean): void => {
    if (!enabled && getAccessibilityOverride() === null) {
        app.commandLine.appendSwitch("disable-renderer-accessibility");
    }
};

const initializeAccessibility = (settingFile: string): void => {
    accessibilityOverride = getAccessibilityOverride();
    try {
        accessibilityEnabled = readEnabledSetting(settingFile);
    } catch (error) {
        // 配置读取失败时保留辅助功能支持，避免阻断已依赖读屏的用户。
        writeLog("read accessibility setting failed: " + errorMessage(error));
    }
    configureAccessibility(accessibilityEnabled);
};

const getAccessibilityState = (): {enabled: boolean; override: boolean | null} =>
    ({enabled: accessibilityEnabled, override: accessibilityOverride});

// 写入成功后同步内存状态，使后续读取立刻反映新设置。
const setAccessibilityEnabled = (settingFile: string, enabled: boolean): void => {
    writeEnabledSetting(settingFile, enabled);
    accessibilityEnabled = enabled;
};

export {
    getAccessibilityOverride, configureAccessibility, initializeAccessibility, getAccessibilityState,
    setAccessibilityEnabled,
};
