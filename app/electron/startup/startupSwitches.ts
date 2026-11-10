import {app} from "electron";
import {appendChromiumSwitch} from "./chromiumSwitches";
import {argName, isBuiltinArg} from "../shared/builtinArgs";
import {writeLog} from "../shared/runtime";
import {getUnsafeRemoteChromiumSwitchName, unsafeRemoteChromiumSwitchNames} from "../remote/remoteKernel";

type UnsafeRemoteSwitchError = Error & {code: string};

// 桌面端启动开关：本地优先直连、按来源隔离渲染进程，并保留 H.265 硬解与混合内容默认行为。
// 远端内核不接管系统代理，因此不追加 no-proxy-server。
const applyStartupSwitches = (remote = false): void => {
    const {commandLine} = app;
    commandLine.appendSwitch("auto-detect", "false");
    if (!remote) {
        commandLine.appendSwitch("no-proxy-server");
    }
    // 同源窗口共享渲染进程，按来源隔离以保留不同端口工作空间之间的进程隔离。
    commandLine.appendSwitch("process-per-site");
    appendChromiumSwitch("--enable-features=PlatformHEVCDecoderSupport,OriginKeyedProcessesByDefault");
    commandLine.appendSwitch("xdg-portal-required-version", "4");
    // 本地 HTTPS 页面加载 HTTP 外链图时，禁止自动升级为 HTTPS
    appendChromiumSwitch("--disable-features=AutoupgradeMixedContent");
};

// 内置参数不转发给 Chromium；远端内核下削弱安全的开关直接忽略。
const forwardCommandLineSwitches = ({argv, packaged, remote}: {
    argv: string[];
    packaged: boolean;
    remote: boolean;
}): boolean => {
    let openAsHidden = false;
    for (let i = packaged ? 1 : 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--") {
            break;
        }
        if (isBuiltinArg(arg)) {
            // --openAsHidden 需要记录，其余内置参数由主进程自行消费，直接跳过。
            if ("--openAsHidden" === argName(arg)) {
                openAsHidden = true;
                writeLog("open as hidden");
            }
            continue;
        }

        if (remote && getUnsafeRemoteChromiumSwitchName(arg)) {
            continue;
        }

        if (appendChromiumSwitch(arg)) {
            writeLog("command line switch [" + arg + "]");
        }
    }
    return openAsHidden;
};

// 远端内核不允许削弱 Web 安全的启动开关：先移除命中的开关，再返回需要报告的错误。
const rejectUnsafeRemoteSwitches = (argv: string[]): UnsafeRemoteSwitchError | undefined => {
    const {commandLine} = app;
    const configuredUnsafeSwitchNames = new Set<string>(
        argv.map(getUnsafeRemoteChromiumSwitchName).filter((switchName): switchName is string => !!switchName));
    unsafeRemoteChromiumSwitchNames.forEach((switchName: string) => {
        if (commandLine.hasSwitch(switchName)) {
            configuredUnsafeSwitchNames.add(switchName);
        }
    });
    const disabledFeatures = commandLine.getSwitchValue("disable-features");
    if (getUnsafeRemoteChromiumSwitchName("--disable-features=" + disabledFeatures)) {
        configuredUnsafeSwitchNames.add("disable-features");
    }
    if (configuredUnsafeSwitchNames.size === 0) {
        return undefined;
    }
    configuredUnsafeSwitchNames.forEach((switchName: string) => commandLine.removeSwitch(switchName));
    const error: UnsafeRemoteSwitchError = Object.assign(new Error("--remote cannot be combined with switches that weaken web security: " +
        Array.from(configuredUnsafeSwitchNames).join(", ")), {code: "ERR_REMOTE_UNSAFE_CHROMIUM_SWITCH"});
    return error;
};

export {
    applyStartupSwitches,
    forwardCommandLineSwitches,
    rejectUnsafeRemoteSwitches,
};
