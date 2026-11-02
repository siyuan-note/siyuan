import * as electron from "electron";
import {getArg, paths, state, writeLog} from "../shared/runtime";
import {errorMessage} from "../shared/errors";
import {showErrorWindow} from "../shared/errorWindow";
import {showAppleSiliconWarning as warnAppleSilicon} from "../kernel/appleSiliconWarning";
import {
    remoteKernelAuthCheckFailedMessage, remoteKernelBootTimeoutMessage, remoteKernelUnreachableMessage,
    remoteKernelVersionMismatchMessage,
} from "../shared/staticMessages";
import {getRemoteSession} from "./connectionManager";
import {getConnectionManager} from "./connectionRuntime";
import * as timing from "../shared/timing";
import {getRemoteKernelVersionStatus, remoteKernelActiveStorageTypes} from "./remoteKernel";
import {
    fetchWithTimeout, installRemoteFrontendProtocol, isRemoteKernelAuthenticated, requestRemoteKernelVersion,
} from "./remoteProtocol";
import type {RemoteVersionPayload} from "./remoteProtocol";
import type {StaticMessage} from "../shared/staticMessages";
import type {BootWindowsApi, KernelTarget} from "../shared/types";

/** 启动页窗口能力由调用方给出：remote 不能引用 window 层。 */
type RemoteBootPage = Pick<BootWindowsApi, "createBootWindow" | "loadBootWindow" | "getBootWindow">;

type RemoteBootResult = {target: KernelTarget; authenticated: boolean};

// 用户在连接管理窗口切换连接时需要中止进行中的远程启动。
let canceled = false;

const cancelRemoteBoot = (): void => {
    canceled = true;
};

// 版本接口的尝试次数与重试间隔；本机请求偶尔早于内核监听端口。
const VERSION_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 500;
const BOOT_PROGRESS_TIMEOUT_MS = 300000;

// 返回 undefined 表示启动被中止或已向用户显示错误窗口，调用方不创建主窗口。
const initRemoteKernel = async (target: KernelTarget,
    {createBootWindow, loadBootWindow, getBootWindow}: RemoteBootPage,
): Promise<RemoteBootResult | undefined> => {
    const connectionManager = getConnectionManager();
    if (!connectionManager) {
        writeLog("ignored remote kernel startup before the connection manager is ready");
        return undefined;
    }
    canceled = false;
    const aborted = (): boolean => canceled;

    // 失败时销毁的是当前启动页：createBootWindow 会替换掉进入函数时的窗口。
    const failBoot = (message: StaticMessage): undefined => {
        showErrorWindow(message.titleZh, message.titleEn, message.content);
        const currentBoot = getBootWindow();
        if (currentBoot && !currentBoot.isDestroyed()) {
            currentBoot.destroy();
        }
        return undefined;
    };

    // 首次连接迁移现有登录 Cookie，切换连接使用的会话由启动参数交接。
    await connectionManager.prepareSession(target);
    await connectionManager.restoreSession(target, getArg("--connection-session"));

    // 建窗、通过 Intel 版本提示后加载，并按是否隐藏启动决定显示方式。
    if (!await showBootPage({createBootWindow, loadBootWindow, getBootWindow})) {
        return undefined;
    }
    await clearActiveStorage(target);

    // 只放行兼容版本，不可达与版本不匹配分别提示。
    const version = await waitForVersion({target, aborted});
    if (aborted()) {
        return undefined;
    }
    const versionStatus = getRemoteKernelVersionStatus(version.data, paths.appVer);
    if (versionStatus === "invalid" || !version.data) {
        return failBoot(remoteKernelUnreachableMessage(version.error));
    }
    writeLog("got remote kernel version [" + version.data.data + "]");
    if (versionStatus === "mismatch") {
        return failBoot(remoteKernelVersionMismatchMessage(paths.appVer, version.data.data));
    }

    // 内核初始化到 100% 才允许进入主窗口。
    if (!await waitForBootProgress({target, aborted})) {
        return aborted() ? undefined : failBoot(remoteKernelBootTimeoutMessage);
    }

    // 认证探测本身失败时提示错误，未认证的情况交给主窗口的认证页处理。
    let authenticated: boolean;
    try {
        authenticated = await isRemoteKernelAuthenticated(target);
    } catch (error) {
        writeLog("probe remote kernel authentication failed: " + errorMessage(error));
        if (aborted()) {
            return undefined;
        }
        return failBoot(remoteKernelAuthCheckFailedMessage(errorMessage(error)));
    }
    if (aborted()) {
        return undefined;
    }
    connectionManager.remember(target.origin);
    installRemoteFrontendProtocol(target);
    return {target, authenticated};
};

// 建启动页并在 Intel 版本提示通过后加载；返回 false 表示用户放弃本次启动或窗口不存在。
const showBootPage = async ({createBootWindow, loadBootWindow, getBootWindow}: RemoteBootPage): Promise<boolean> => {
    createBootWindow();

    if (!await warnAppleSilicon(getArg("--lang") || "")) {
        const bootWindow = getBootWindow();
        if (bootWindow && !bootWindow.isDestroyed()) {
            bootWindow.destroy();
        }
        electron.app.quit();
        return false;
    }
    loadBootWindow();
    const currentBoot = getBootWindow();
    if (!currentBoot) {
        return false;
    }
    if (state.startup.openAsHidden) {
        currentBoot.minimize();
    } else {
        currentBoot.show();
    }
    return true;
};

// 清掉可能带旧前端资源的存储，其余会话数据保留登录态。
const clearActiveStorage = async (target: KernelTarget): Promise<void> => {
    try {
        await getRemoteSession(target).clearStorageData({
            origin: target.origin,
            // 冻结的常量是只读数组，Electron 需要可变数组。
            storages: [...remoteKernelActiveStorageTypes],
        });
    } catch (error) {
        throw new Error("failed to clear remote kernel active storage: " + errorMessage(error), {cause: error});
    }
};

type RemotePollStage = {
    target: KernelTarget;
    aborted: () => boolean;
};

// 版本接口按固定次数重试，仍失败时把最后一次错误交给调用方决定提示内容。
const waitForVersion = async ({target, aborted}: RemotePollStage): Promise<{
    data?: RemoteVersionPayload;
    error: string;
}> => {
    writeLog("connecting to remote kernel [origin=" + target.origin + "]");
    let error = "";
    for (let count = 0; count < VERSION_ATTEMPTS; count++) {
        if (aborted()) {
            return {error};
        }
        try {
            return {data: await requestRemoteKernelVersion(target), error: ""};
        } catch (cause) {
            error = errorMessage(cause);
            writeLog("get remote kernel version failed: " + error);
            if (count < VERSION_ATTEMPTS - 1) {
                await timing.sleep(POLL_INTERVAL_MS);
            }
        }
    }
    return {error};
};

// 轮询启动进度，100% 返回 true；超时或被中止返回 false，由调用方区分提示。
const waitForBootProgress = async ({target, aborted}: RemotePollStage): Promise<boolean> => {
    const bootShowStart = Date.now();
    while (!aborted() && Date.now() - bootShowStart <= BOOT_PROGRESS_TIMEOUT_MS) {
        try {
            const response = await fetchWithTimeout(target, target.origin + "/api/system/bootProgress");
            if (!response.ok) {
                await response.body?.cancel();
                throw new Error("boot progress request returned HTTP " + response.status);
            }
            const progressData = await response.json() as {data?: {progress?: number}};
            if ((progressData.data?.progress ?? 0) >= 100) {
                return true;
            }
        } catch (error) {
            writeLog("get remote boot progress failed: " + errorMessage(error));
        }
        await timing.sleep(POLL_INTERVAL_MS);
    }
    return false;
};

export {initRemoteKernel, cancelRemoteBoot};
