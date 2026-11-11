import {app, dialog} from "electron";
import {Channel} from "../shared/channels";
import {loadAppMenuLanguages, resolveAppLanguage} from "../shared/language";
import {state, writeLog} from "../shared/runtime";
import {requestKernelExit} from "../kernel/kernelEndpoint";
import {exitWorkspace} from "./appExit";
import type {BrowserWindow, MessageBoxOptions} from "electron";
import type {KernelExitRequest, Workspace} from "../shared/types";

type CloseRecoveryOptions = {
    scheduleTimer?: (callback: () => void, ms: number) => unknown;
    cancelTimer?: (timer: unknown) => void;
    showMessage?: (options: MessageBoxOptions) => Promise<{response: number}>;
    languages?: Record<string, string | undefined>;
    requestExit?: KernelExitRequest;
    findWorkspace?: () => Workspace | undefined;
    exit?: typeof exitWorkspace;
};

type PendingClose = {
    quit: boolean;
    timer?: unknown;
    controller: AbortController;
};

const requests = new WeakMap<BrowserWindow, {
    request: (quit: boolean) => void;
    finishHide: () => void;
}>();

const installWindowCloseRecovery = (window: BrowserWindow, {
    scheduleTimer = setTimeout,
    cancelTimer = timer => clearTimeout(timer as NodeJS.Timeout),
    showMessage = options => dialog.showMessageBox(window, options),
    languages = loadAppMenuLanguages(resolveAppLanguage(app.getPreferredSystemLanguages())),
    requestExit = requestKernelExit,
    findWorkspace = () => state.workspaces.find(item => item.webContentsId === window.webContents.id),
    exit = exitWorkspace,
}: CloseRecoveryOptions = {}): void => {
    let pending: PendingClose | undefined;
    const finish = (request: PendingClose) => {
        if (pending !== request) return;
        pending = undefined;
        cancelTimer(request.timer);
        request.controller.abort();
    };
    const recover = async (request: PendingClose) => {
        const {signal} = request.controller;
        try {
            if (signal.aborted || window.isDestroyed()) return;
            // 页面仍能执行脚本时继续由界面处理隐藏、保存确认和同步，避免干扰正常的长任务。
            const responsive = await Promise.race([
                window.webContents.executeJavaScript("void 0").then(() => true, () => false),
                new Promise<boolean>(resolve => { request.timer = scheduleTimer(() => resolve(false), 1000); }),
            ]);
            cancelTimer(request.timer);
            if (responsive || signal.aborted || window.isDestroyed()) return;
            const decision = await showMessage({type: "warning", title: "SiYuan",
                message: languages.windowCloseTimeout ?? "", buttons: [languages.cancel ?? "", languages.confirm ?? ""],
                defaultId: 0, cancelId: 0, noLink: true, signal});
            if (decision.response !== 1 || signal.aborted || window.isDestroyed()) return;
            const workspace = findWorkspace();
            if (!workspace) return;
            request.quit = true;
            if (!workspace.ownsKernel) {
                exit(workspace);
                return;
            }
            const timeout = new AbortController();
            request.timer = scheduleTimer(() => timeout.abort(), 30000);
            try {
                const response = await requestExit(workspace.port, {
                    force: false, setCurrentWorkspace: true, execInstallPkg: 1,
                }, AbortSignal.any([signal, timeout.signal]));
                const result = await response?.json();
                if (signal.aborted || window.isDestroyed()) return;
                if (result?.code === 0 || state.kernel.exitedPorts.has(workspace.port.toString())) {
                    exit(workspace);
                } else {
                    await showMessage({type: "error", title: "SiYuan", message: languages.exitWaitFailed ?? "",
                        buttons: [languages.confirm ?? ""], signal});
                }
            } finally {
                cancelTimer(request.timer);
            }
        } catch (error) {
            if (signal.aborted || window.isDestroyed()) return;
            writeLog("window close recovery failed: " + error);
            await showMessage({type: "error", title: "SiYuan", message: languages.exitWaitFailed ?? "",
                buttons: [languages.confirm ?? ""], signal}).catch(error => writeLog("close recovery dialog failed: " + error));
        } finally {
            finish(request);
        }
    };
    requests.set(window, {
        request: quit => {
            if (pending) {
                if (quit) {
                    pending.quit = true;
                    window.webContents.send(Channel.SIYUAN_SAVE_CLOSE, true);
                }
                return;
            }
            const request: PendingClose = {quit, controller: new AbortController()};
            pending = request;
            // 界面保存、确认和同步可能等待较久，超时仅提供原生确认入口，不自动丢弃编辑。
            request.timer = scheduleTimer(() => { void recover(request); }, 15000);
            window.webContents.send(Channel.SIYUAN_SAVE_CLOSE, quit);
        },
        finishHide: () => {
            // 隐藏仅完成窗口关闭请求，退出应用仍需等待界面或内核。
            if (pending && !pending.quit) finish(pending);
        },
    });
    window.once("closed", () => {
        requests.delete(window);
        if (pending) finish(pending);
    });
};

const requestWindowClose = (window: BrowserWindow, quit: boolean): void => {
    if (window.isDestroyed()) return;
    const request = requests.get(window);
    if (request) request.request(quit);
    else window.webContents.send(Channel.SIYUAN_SAVE_CLOSE, quit);
};

const finishWindowCloseOnHide = (window: BrowserWindow): void => {
    requests.get(window)?.finishHide();
};

export {finishWindowCloseOnHide, installWindowCloseRecovery, requestWindowClose};
