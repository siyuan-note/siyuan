import * as electron from "electron";
import {
    paths, state, writeLog, isSystemShuttingDown,
} from "../shared/runtime";
import {requestKernelExit} from "../kernel/kernelEndpoint";
import {exitApp} from "../window/appExit";
import {showWindow} from "../window/windowVisibility";
import {getSystemShutdownPorts} from "./systemShutdown";
import {createUpdateInstall} from "./updateInstall";
import {
    cancelMarkdownQuit, closeMarkdownEditors, hasPendingMarkdownWork, prepareMarkdownQuit,
} from "./markdownEditors";
import type {IpcMainInvokeEvent} from "electron";
import type {Workspace} from "../shared/types";

type UpdateRequest = {initiatingPort: string; setCurrentWorkspace: boolean; workspaceDir: string};

type UpdateInstallRequest = {port: string | number; setCurrentWorkspace?: boolean};

type KernelExitResponse = {data?: {installPkgPath?: string}};

// 内核退出后等待进程消失的上限；超时后强制结束残留进程。
const updateKernelExitTimeout = 30000;

const kernelProcesses = (): Map<string, import("node:child_process").ChildProcess> => state.kernel.processes;
const workspaces = (): Workspace[] => state.workspaces;

// 更新安装是全进程唯一的一次性流程，状态放在共享运行期状态里，
// 让退出、崩溃处理与 quit 拦截都能读到同一份值。
const setUpdateInstallPromise = (promise: Promise<void> | undefined): void => {
    state.exit.updateInstall = promise;
};

const setKeepAppOpen = (keepOpen: boolean): void => {
    state.exit.keepOpenForUpdate = keepOpen;
};

const waitForKernelProcessExit = (port: string | number, timeout: number): Promise<boolean> => {
    const portKey = port.toString();
    const kernelProcess = kernelProcesses().get(portKey);
    if (!kernelProcess) {
        return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
        const onClose = () => {
            clearTimeout(timer);
            resolve(true);
        };
        kernelProcess.once("close", onClose);
        const timer = setTimeout(() => {
            kernelProcess.removeListener("close", onClose);
            resolve(false);
        }, timeout);
    });
};

const requestUpdateKernelExit = async (port: string | number,
    options: {force: boolean; setCurrentWorkspace: boolean; execInstallPkg: number}) => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), updateKernelExitTimeout);
    try {
        const response = await requestKernelExit(port, options, abortController.signal);
        if (!response) {
            return false;
        }
        const apiData = await response.json();
        if (apiData.code === 0) {
            writeLog("update kernel exit request succeeded [port=" + port + "]");
            return apiData;
        }
        writeLog("update kernel exit request failed [port=" + port + ", code=" + apiData.code + "]");
    } catch (error) {
        writeLog("parse update kernel exit response failed [port=" + port + "]: " + error);
    } finally {
        clearTimeout(timeout);
    }
    return false;
};

// 发起更新的工作空间可以强制退出并携带工作空间切换；其余工作空间只做优雅退出。
const closeKernelForUpdate = async (port: string, initiatingPort: string, setCurrentWorkspace: boolean) => {
    const isInitiatingKernel = port === initiatingPort;
    const exitResponse = await requestUpdateKernelExit(port, {
        force: isInitiatingKernel,
        setCurrentWorkspace: isInitiatingKernel && setCurrentWorkspace,
        execInstallPkg: isInitiatingKernel ? 2 : 1,
    });
    if (exitResponse) {
        return exitResponse;
    }

    writeLog("forcing kernel to exit for update [port=" + port + "]");
    return requestUpdateKernelExit(port, {
        force: true,
        setCurrentWorkspace: isInitiatingKernel && setCurrentWorkspace,
        execInstallPkg: isInitiatingKernel ? 2 : 1,
    });
};

// 只接受来自拥有内核的工作空间、且端口与其一致的本机请求。
const validateRequest = (webContentsId: number, data: UpdateInstallRequest): UpdateRequest | undefined => {
    const workspace = workspaces().find((item: Workspace) => item.webContentsId === webContentsId);
    if (!workspace || !workspace.ownsKernel || !workspace.workspaceDir || !data || !data.port ||
        workspace.port.toString() !== data.port.toString()) {
        writeLog("rejected update install request from an unknown workspace");
        return;
    }
    if (process.platform !== "win32" && process.platform !== "darwin") {
        writeLog("rejected update install request on unsupported platform [platform=" + process.platform + "]");
        return;
    }

    return {
        initiatingPort: workspace.port.toString(),
        setCurrentWorkspace: data.setCurrentWorkspace !== false,
        workspaceDir: workspace.workspaceDir,
    };
};

const waitForUpdateKernelExits = async (ports: string[]): Promise<void> => {
    if (ports.length === 0) {
        return;
    }

    const exitResults = await Promise.all(ports.map(async (port: string) => {
        return {
            port,
            exited: await waitForKernelProcessExit(port, updateKernelExitTimeout),
        };
    }));
    const timedOutPorts = exitResults.filter((item) => !item.exited).map((item) => item.port);
    if (timedOutPorts.length === 0) {
        return;
    }

    writeLog("kernel exit timed out before update [ports=" + timedOutPorts.join(",") + "]");
    timedOutPorts.forEach((port: string) => {
        const kernelProcess = kernelProcesses().get(port);
        if (kernelProcess) {
            writeLog("terminating residual kernel before update [pid=" + kernelProcess.pid + ", port=" + port + "]");
            kernelProcess.kill("SIGKILL");
        }
    });
    await Promise.all(timedOutPorts.map((port: string) => waitForKernelProcessExit(port, 5000)));
    const residualPorts = timedOutPorts.filter((port: string) => kernelProcesses().has(port));
    if (residualPorts.length > 0) {
        if (process.platform === "win32") {
            writeLog("residual kernel processes will be terminated by the installer [ports=" + residualPorts.join(",") + "]");
        } else {
            throw new Error("failed to terminate residual kernel processes [ports=" + residualPorts.join(",") + "]");
        }
    }
};

const closeUpdateKernelStage = async (ports: string[], request: UpdateRequest): Promise<KernelExitResponse[]> => {
    if (ports.length === 0) {
        return [];
    }

    const exitResponses = await Promise.all(ports.map((port: string) => closeKernelForUpdate(port,
        request.initiatingPort, request.setCurrentWorkspace)));
    ports.forEach((port: string) => exitApp(port));
    await waitForUpdateKernelExits(ports);
    return exitResponses as KernelExitResponse[];
};

const getUpdateInstall = () => createUpdateInstall({confDir: paths.confDir, writeLog});

// 更新时先退出其他工作空间，再退出发起更新的工作空间，确保安装器启动前所有内核已经停止。
// https://github.com/siyuan-note/siyuan/issues/18258
const coordinateUpdateInstall = async (request: UpdateRequest): Promise<void> => {
    // 安装器启动前必须关掉全部 Markdown 窗口；用户在窗口里取消时整个安装放弃。
    if (!await prepareMarkdownQuit("update")) {
        throw Object.assign(new Error("Markdown windows canceled update installation"),
            {code: "MARKDOWN_EXIT_CANCELED"});
    }

    const ports = Array.from(new Set<string>(getSystemShutdownPorts().map((port: string | number) => port.toString())
        .concat(Array.from(kernelProcesses().keys()), request.initiatingPort)));
    ports.forEach((port: string) => state.kernel.expectedExitPorts.add(port));
    writeLog("coordinating update install [initiatingPort=" + request.initiatingPort + ", ports=" + ports.join(",") +
        "]");

    workspaces().forEach((workspace: Workspace) => {
        if (workspace.browserWindow && !workspace.browserWindow.isDestroyed()) {
            workspace.browserWindow.hide();
        }
    });

    const otherPorts = ports.filter((port: string) => port !== request.initiatingPort);
    writeLog("closing other workspaces for update [ports=" + otherPorts.join(",") + "]");
    await closeUpdateKernelStage(otherPorts, request);
    writeLog("closing initiating workspace for update [port=" + request.initiatingPort + "]");
    const [initiatingExitResponse] = await closeUpdateKernelStage([request.initiatingPort], request);
    const {validateUpdateInstallPackage, launchUpdateInstallPackage} = getUpdateInstall();
    const installPkgPath = validateUpdateInstallPackage(request,
        initiatingExitResponse?.data?.installPkgPath);
    if (!installPkgPath) {
        throw new Error("the update install package returned by the kernel is invalid");
    }

    if (!await closeMarkdownEditors()) {
        throw Object.assign(new Error("Markdown windows could not close for update"),
            {code: "MARKDOWN_EXIT_CANCELED"});
    }
    await launchUpdateInstallPackage(installPkgPath);
    setKeepAppOpen(false);
    electron.app.exit();
};

const beginUpdateInstall = (event: IpcMainInvokeEvent, data: UpdateInstallRequest): boolean => {
    if (state.exit.updateInstall) {
        writeLog("ignored duplicate update install request");
        return true;
    }
    if (isSystemShuttingDown()) {
        writeLog("rejected update install request during system shutdown");
        return false;
    }

    const request = validateRequest(event.sender.id, data);
    if (!request) {
        return false;
    }

    setKeepAppOpen(true);
    setUpdateInstallPromise(coordinateUpdateInstall(request).catch((error: unknown) => {
        writeLog("coordinate update install failed: " + error);
        setKeepAppOpen(false);
        setUpdateInstallPromise(undefined);
        cancelMarkdownQuit();

        // Markdown 窗口取消了安装：它自己还在显示，因此把工作空间重新拿出来而不是重启。
        if ((error as {code?: string}).code === "MARKDOWN_EXIT_CANCELED" || hasPendingMarkdownWork()) {
            workspaces().forEach((workspace: Workspace) => {
                if (workspace.browserWindow && !workspace.browserWindow.isDestroyed()) {
                    showWindow(workspace.browserWindow);
                }
            });
            state.markdown.windows?.focus();
            return;
        }
        electron.app.relaunch();
        electron.app.exit();
    }));
    return true;
};

// 更新安装的发起入口；其余模块只读取 state.exit.updateInstall 判断是否正在安装。
export {beginUpdateInstall};
