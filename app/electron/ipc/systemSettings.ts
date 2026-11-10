// `siyuan-get` 的系统与界面设置命令：Linux 输入法兼容、辅助功能、代理、麦克风与拼写检查语言。
import * as electron from "electron";
import {paths} from "../shared/runtime";
import {getAccessibilityState, setAccessibilityEnabled} from "../startup/accessibility";
import {getLinuxInputMethodState, setLinuxInputMethodEnabled} from "../startup/linuxInputMethod";
import {setProxy} from "../window/windowNavigation";
import type {GetHandler} from "./getContract";

const getLinuxInputMethodSetting: GetHandler = ({data, kernelTarget, isMainFrame, initialized}) => {
    if (process.platform !== "linux" || !initialized || !kernelTarget || !isMainFrame) {
        throw new Error("Linux input method setting is unavailable");
    }
    const current = getLinuxInputMethodState();
    if (current.argumentsError) {
        throw current.argumentsError;
    }
    if (data.cmd === "setLinuxInputMethodSetting") {
        setLinuxInputMethodEnabled(data.enabled as boolean);
    }
    return {enabled: getLinuxInputMethodState().enabled, override: current.override};
};

const getAccessibilitySetting: GetHandler = ({data, kernelTarget, isMainFrame, initialized}) => {
    if (!initialized || !kernelTarget || !isMainFrame) {
        throw new Error("Accessibility setting is unavailable");
    }
    if (data.cmd === "setAccessibilitySetting") {
        setAccessibilityEnabled(paths.accessibilitySettingPath, data.enabled as boolean);
    }
    return getAccessibilityState();
};

const availableSpellCheckerLanguages: GetHandler = ({event}) =>
    event.sender.session.availableSpellCheckerLanguages;

const getMicrophone: GetHandler = () => electron.systemPreferences.getMediaAccessStatus("microphone");

const askMicrophone: GetHandler = () => electron.systemPreferences.askForMediaAccess("microphone");

const systemSettingHandlers: Record<string, GetHandler> = {
    "getLinuxInputMethodSetting": getLinuxInputMethodSetting,
    "setLinuxInputMethodSetting": getLinuxInputMethodSetting,
    "getAccessibilitySetting": getAccessibilitySetting,
    "setAccessibilitySetting": getAccessibilitySetting,
    "availableSpellCheckerLanguages": availableSpellCheckerLanguages,
    "setProxy": ({event, data}) => setProxy(data.proxyURL as string, event.sender, data.proxyMode as string),
    "getMicrophone": getMicrophone,
    "askMicrophone": askMicrophone,
};

export {systemSettingHandlers};
