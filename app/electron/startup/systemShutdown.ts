import * as electron from "electron";
import {
    state, writeLog,
    SYSTEM_SHUTDOWN_NONE, SYSTEM_SHUTDOWN_ENDING, SYSTEM_SHUTDOWN_FORCED,
} from "../shared/runtime";
import {exitApp} from "../window/appExit";
import {showWindow} from "../window/windowVisibility";
import {getBootWindows as getRegisteredBootWindows} from "../window/windowRegistry";
import {requestKernelExit} from "../kernel/kernelEndpoint";
import {requestGracefulKernelExit} from "../kernel/kernelExit";
import type {BootWindow, Workspace} from "../shared/types";

type SystemShutdownPort = string | number;

type GracefulExitResult = {port: SystemShutdownPort; success: boolean};

// 只有外部副作用需要替换，默认就是真实实现。
type ShutdownPorts = {
    exitApp?: () => void;
    gracefulExit?: (port: SystemShutdownPort) => Promise<boolean>;
};

// 关机状态与工作空间、启动页窗口都来自共享运行期状态。
const getBootWindows = (): BootWindow[] => Array.from(getRegisteredBootWindows() as Set<BootWindow>);

const getSystemShutdownPorts = (): SystemShutdownPort[] => {
    const ports = new Set<SystemShutdownPort>();
    (state.workspaces as Workspace[]).forEach((workspaceItem: Workspace) => {
        if (workspaceItem.ownsKernel && workspaceItem.port) {
            ports.add(workspaceItem.port);
        }
    });
    if (!state.startup.remoteKernelTarget) {
        getBootWindows().forEach((window: BootWindow) => {
            if (!window.isDestroyed() && window.kernelPort) ports.add(window.kernelPort);
        });
    }
    return Array.from(ports);
};

// 优雅退出未能完成时撤销关机状态，把仍在运行的内核对应窗口重新显示出来。
const resetSystemShutdown = (ports: SystemShutdownPort[]): void => {
    if (state.exit.systemShutdown === SYSTEM_SHUTDOWN_FORCED) {
        return;
    }

    state.exit.systemShutdown = SYSTEM_SHUTDOWN_NONE;
    state.exit.gracefulShutdown = undefined;
    state.exit.keepOpenForShutdown = false;
    writeLog("system shutdown canceled because SiYuan failed to exit gracefully [ports=" + ports.join(",") + "]");
    const workspaces = state.workspaces as Workspace[];
    ports.forEach((port: SystemShutdownPort) => {
        const workspace = workspaces.find((item: Workspace) => port.toString() === item.port.toString());
        if (workspace && workspace.browserWindow && !workspace.browserWindow.isDestroyed()) {
            showWindow(workspace.browserWindow);
        }
    });
    getBootWindows().forEach((window: BootWindow) => {
        if (ports.includes(window.kernelPort as SystemShutdownPort)) showWindow(window);
    });
};

const beginGracefulSystemShutdown = ({exitApp: exit = () => electron.app.exit(),
    gracefulExit = requestGracefulKernelExit}: ShutdownPorts = {}): void => {
    if (state.exit.gracefulShutdown || state.exit.systemShutdown === SYSTEM_SHUTDOWN_FORCED) {
        return;
    }

    state.exit.systemShutdown = SYSTEM_SHUTDOWN_ENDING;
    const ports = getSystemShutdownPorts();
    if (ports.length === 0) {
        exit();
        return;
    }

    state.exit.keepOpenForShutdown = true;
    state.exit.gracefulShutdown = Promise.all<GracefulExitResult>(
        ports.map(async (port: SystemShutdownPort) => ({port, success: await gracefulExit(port)})))
        .then((results: GracefulExitResult[]) => {
            const succeededPorts = results.filter((item: GracefulExitResult) => item.success)
                .map((item: GracefulExitResult) => item.port);
            const failedPorts = results.filter((item: GracefulExitResult) => !item.success)
                .map((item: GracefulExitResult) => item.port);
            succeededPorts.forEach((port: SystemShutdownPort) => exitApp(port));
            getBootWindows().forEach((window: BootWindow) => {
                if (!window.isDestroyed() && succeededPorts.includes(window.kernelPort as SystemShutdownPort)) window.destroy();
            });

            const remainingPorts = getSystemShutdownPorts();
            const incompletePorts = Array.from(new Set<SystemShutdownPort>(failedPorts.concat(remainingPorts)));
            if (incompletePorts.length > 0) {
                resetSystemShutdown(incompletePorts);
                return;
            }
            state.exit.keepOpenForShutdown = false;
            exit();
        }).catch((error: unknown) => {
            writeLog("graceful system shutdown failed: " + error);
            resetSystemShutdown(getSystemShutdownPorts());
        });
};

const beginForcedSystemShutdown = ({requestKernelExit: requestExit = requestKernelExit}: {
    requestKernelExit?: (port: SystemShutdownPort, options: {force: boolean; setCurrentWorkspace: boolean}) => unknown;
} = {}): void => {
    if (state.exit.systemShutdown === SYSTEM_SHUTDOWN_FORCED) {
        return;
    }

    state.exit.systemShutdown = SYSTEM_SHUTDOWN_FORCED;
    state.exit.keepOpenForShutdown = false;
    getSystemShutdownPorts().forEach((port: SystemShutdownPort) => {
        requestExit(port, {
            force: true,
            setCurrentWorkspace: false,
        });
    });
};

export {
    getSystemShutdownPorts,
    beginGracefulSystemShutdown,
    beginForcedSystemShutdown,
};
