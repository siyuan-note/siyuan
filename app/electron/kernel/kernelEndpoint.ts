// 本机内核的地址与目标构造，以及通过 `/api/system/exit` 请求退出。
import {net} from "electron";
import {state, writeLog} from "../shared/runtime";
import type {KernelExitOptions, KernelExitRequest, KernelExitResponse, KernelTarget} from "../shared/types";

const localServer = "https://127.0.0.1";

const getServer = (port: string | number = state.kernel.port): string => localServer + ":" + port;

const createLocalKernelTarget = (port: string | number = state.kernel.port): KernelTarget => ({
    mode: "local",
    origin: localServer + ":" + port,
    ownsKernel: true,
    port: port.toString(),
});

const getKernelTarget = (target: string | number | KernelTarget = state.kernel.port): KernelTarget =>
    "object" === typeof target && target ? target as KernelTarget : createLocalKernelTarget(target as string | number);

// 请求内核退出。请求失败只记录日志，调用方以已观测到的进程退出为准。
const requestKernelExit: KernelExitRequest = async (port: string | number, options: KernelExitOptions = {},
    signal?: AbortSignal): Promise<KernelExitResponse | undefined> => {
    if (!port) {
        return Promise.resolve(undefined);
    }

    const exitOptions = Object.assign({
        force: false,
        setCurrentWorkspace: true,
        execInstallPkg: 1,
    }, options);
    try {
        return await net.fetch(getServer(port) + "/api/system/exit", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(exitOptions),
            signal,
        });
    } catch (error) {
        writeLog("shutdown kernel failed [port=" + port + "]: " + error);
        return undefined;
    }
};

export {getServer, createLocalKernelTarget, getKernelTarget, requestKernelExit};
