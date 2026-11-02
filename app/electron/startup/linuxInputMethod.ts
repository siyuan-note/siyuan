import * as crypto from "node:crypto";
import {app} from "electron";
import {errorMessage, toError} from "../shared/errors";
import {writeLog} from "../shared/runtime";
import {readEnabledSetting, writeEnabledSetting} from "./enabledSettingFile";

type LinuxInputMethodLaunch = {
    args: string[];
    override: boolean | null;
    relaunchArgs: string[] | null;
    relaunchToken: string | null;
};

/** 兼容模式开关与上一次重启携带的标记。 */
type LinuxInputMethodLaunchOptions = {
    enabled: boolean;
    relaunchToken?: string;
};

const linuxInputMethodRelaunchEnvironment = "SIYUAN_LINUX_INPUT_METHOD_RELAUNCH";
const linuxInputMethodRelaunchSwitch = "--siyuan-linux-input-method-relaunch=";

// 设置文件路径、开关与启动参数覆盖都属于本机输入法兼容设置，由本模块持有。
let managedSettingFile = "";
let linuxInputMethodEnabled = false;
let linuxInputMethodOverride: boolean | null = null;
let linuxInputMethodArgumentsError: Error | null = null;

// 显式显示后端参数优先于本机兼容设置，重复参数采用最后一次指定的值。
const getLinuxInputMethodBackend = (args: string[]): string | null => {
    let backend: string | null = null;
    for (let i = 1; i < args.length && args[i] !== "--"; i++) {
        if (args[i].startsWith("--ozone-platform=")) {
            backend = args[i].slice("--ozone-platform=".length);
        } else if (args[i] === "--ozone-platform") {
            backend = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "";
        }
    }
    return backend;
};

const getLinuxInputMethodOverride = (args: string[]): boolean | null => {
    const backend = getLinuxInputMethodBackend(args);
    return backend === null ? null : backend === "x11";
};

// 原生后端在应用脚本加载前选定，通过重启把兼容参数交给下一进程的原生启动阶段。
// 随机标记仅在进程环境中传递，用于区分本机设置生成的参数和用户显式参数。
const prepareLinuxInputMethodLaunch = (args: string[], platform: NodeJS.Platform,
    {enabled, relaunchToken}: LinuxInputMethodLaunchOptions): LinuxInputMethodLaunch => {
    const original = args.slice();
    const result: LinuxInputMethodLaunch = {args: original, override: null, relaunchArgs: null, relaunchToken: null};
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

const initializeLinuxInputMethod = ({platform, settingFile, launchArguments, env,
    readSetting = readEnabledSetting}: {
        platform: NodeJS.Platform;
        settingFile: string;
        launchArguments: string[];
        env: NodeJS.ProcessEnv;
        /** 测试接缝：用例绕过设置文件直接给出开关。 */
        readSetting?: (file: string) => boolean;
    }): void => {
    managedSettingFile = settingFile;
    if (platform !== "linux") {
        return;
    }
    try {
        linuxInputMethodEnabled = readSetting(settingFile);
    } catch (error) {
        writeLog("read Linux input method setting failed: " + errorMessage(error));
    }
    // 每次初始化都从空覆盖值与空错误起步，解析成功后才写入本次结果。
    linuxInputMethodOverride = null;
    linuxInputMethodArgumentsError = null;
    try {
        const launch = prepareLinuxInputMethodLaunch(launchArguments, platform, {
            enabled: linuxInputMethodEnabled,
            relaunchToken: env[linuxInputMethodRelaunchEnvironment],
        });
        linuxInputMethodOverride = launch.override;
        launchArguments.splice(0, launchArguments.length, ...launch.args);
        if (launch.relaunchArgs) {
            if (launch.relaunchToken) {
                env[linuxInputMethodRelaunchEnvironment] = launch.relaunchToken;
            } else {
                delete env[linuxInputMethodRelaunchEnvironment];
            }
            // relaunch 没有失败信号，参数错误会以异常形式抛出并由下方捕获。
            app.relaunch({args: launch.relaunchArgs});
            app.exit(0);
        }
    } catch (error) {
        linuxInputMethodArgumentsError = toError(error);
        writeLog("prepare Linux input method launch failed: " + errorMessage(error));
    }
};

const getLinuxInputMethodState = (): {enabled: boolean; override: boolean | null; argumentsError: Error | null} =>
    ({enabled: linuxInputMethodEnabled, override: linuxInputMethodOverride, argumentsError: linuxInputMethodArgumentsError});

// 写入成功后同步内存状态，使后续读取立刻反映新设置。
const setLinuxInputMethodEnabled = (enabled: boolean): void => {
    writeEnabledSetting(managedSettingFile, enabled);
    linuxInputMethodEnabled = enabled;
};

export {
    getLinuxInputMethodOverride, prepareLinuxInputMethodLaunch,
    linuxInputMethodRelaunchEnvironment, initializeLinuxInputMethod, getLinuxInputMethodState,
    setLinuxInputMethodEnabled,
};
