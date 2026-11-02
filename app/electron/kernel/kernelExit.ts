import {state, writeLog} from "../shared/runtime";
import * as kernelEndpoint from "./kernelEndpoint";
import type {KernelExitRequest} from "../shared/types";

const systemShutdownExitTimeout = 30000;

// 传输层与计时器可替换，其余依赖直接使用共享实例。
type GracefulKernelExitPorts = {
    requestKernelExit?: KernelExitRequest;
    timeout?: number;
    scheduleTimer?: (callback: () => void, ms: number) => unknown;
    cancelTimer?: (timer: unknown) => void;
};

// 优雅退出某个内核：只有内核确实退出才返回 true，请求失败时以已观测到的退出为准。
// execInstallPkg 为 1 表示系统关机流程允许内核继续执行已下载的更新安装包。
const requestGracefulKernelExit = async (port: string | number, {
    requestKernelExit = kernelEndpoint.requestKernelExit,
    timeout = systemShutdownExitTimeout,
    scheduleTimer = setTimeout,
    cancelTimer = (timer: unknown) => clearTimeout(timer as NodeJS.Timeout | undefined),
}: GracefulKernelExitPorts = {}): Promise<boolean> => {
    const portKey = port.toString();
    if (state.kernel.exitedPorts.has(portKey)) {
        return true;
    }
    const abortController = new AbortController();
    const timer = scheduleTimer(() => abortController.abort(), timeout);
    try {
        const response = await requestKernelExit(port, {
            force: false,
            setCurrentWorkspace: false,
            execInstallPkg: 1,
        }, abortController.signal);
        if (!response) {
            return state.kernel.exitedPorts.has(portKey);
        }

        const apiData = await response.json();
        if (apiData.code !== 0) {
            writeLog("graceful system shutdown failed [port=" + port + ", code=" + apiData.code + "]");
            return state.kernel.exitedPorts.has(portKey);
        }
        writeLog("graceful system shutdown succeeded [port=" + port + "]");
        return true;
    } catch (error) {
        writeLog("parse graceful system shutdown response failed [port=" + port + "]: " + error);
        return state.kernel.exitedPorts.has(portKey);
    } finally {
        cancelTimer(timer);
    }
};

export {requestGracefulKernelExit};
