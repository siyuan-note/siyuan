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

const requests = new WeakMap<BrowserWindow, (quit: boolean) => void>();

const installWindowCloseRecovery = (window: BrowserWindow, {
    scheduleTimer = setTimeout,
    cancelTimer = timer => clearTimeout(timer as NodeJS.Timeout),
    showMessage = options => dialog.showMessageBox(window, options),
    languages = loadAppMenuLanguages(resolveAppLanguage(app.getPreferredSystemLanguages())),
    requestExit = requestKernelExit,
    findWorkspace = () => state.workspaces.find(item => item.webContentsId === window.webContents.id),
    exit = exitWorkspace,
}: CloseRecoveryOptions = {}): void => {
    let pending = false;
    let timer: unknown;
    let disposed = false;
    let activeRequest: AbortController | undefined;
    const recover = async () => {
        try {
            if (disposed || window.isDestroyed()) return;
            // 页面仍能执行脚本时继续由界面处理隐藏、保存确认和同步，避免干扰正常的长任务。
            const responsive = await Promise.race([
                window.webContents.executeJavaScript("void 0").then(() => true, () => false),
                new Promise<boolean>(resolve => { timer = scheduleTimer(() => resolve(false), 1000); }),
            ]);
            cancelTimer(timer);
            if (responsive || disposed || window.isDestroyed()) return;
            const decision = await showMessage({type: "warning", title: "SiYuan",
                message: languages.windowCloseTimeout ?? "", buttons: [languages.cancel ?? "", languages.confirm ?? ""],
                defaultId: 0, cancelId: 0, noLink: true});
            if (decision.response !== 1 || disposed || window.isDestroyed()) return;
            const workspace = findWorkspace();
            if (!workspace) return;
            if (!workspace.ownsKernel) {
                exit(workspace);
                return;
            }
            const controller = new AbortController();
            activeRequest = controller;
            timer = scheduleTimer(() => controller.abort(), 30000);
            try {
                const response = await requestExit(workspace.port, {
                    force: false, setCurrentWorkspace: true, execInstallPkg: 1,
                }, controller.signal);
                const result = await response?.json();
                if (disposed || window.isDestroyed()) return;
                if (result?.code === 0 || state.kernel.exitedPorts.has(workspace.port.toString())) {
                    exit(workspace);
                } else {
                    await showMessage({type: "error", title: "SiYuan", message: languages.exitWaitFailed ?? "",
                        buttons: [languages.confirm ?? ""]});
                }
            } finally {
                cancelTimer(timer);
                activeRequest = undefined;
            }
        } catch (error) {
            writeLog("window close recovery failed: " + error);
            if (!disposed && !window.isDestroyed()) {
                await showMessage({type: "error", title: "SiYuan", message: languages.exitWaitFailed ?? "",
                    buttons: [languages.confirm ?? ""]}).catch(error => writeLog("close recovery dialog failed: " + error));
            }
        } finally {
            pending = false;
        }
    };
    requests.set(window, quit => {
        if (disposed || window.isDestroyed()) return;
        if (pending) {
            if (quit) window.webContents.send(Channel.SIYUAN_SAVE_CLOSE, true);
            return;
        }
        pending = true;
        // 界面保存、确认和同步可能等待较久，超时仅提供原生确认入口，不自动丢弃编辑。
        timer = scheduleTimer(() => { void recover(); }, 15000);
        window.webContents.send(Channel.SIYUAN_SAVE_CLOSE, quit);
    });
    window.once("closed", () => {
        disposed = true;
        activeRequest?.abort();
        cancelTimer(timer);
        requests.delete(window);
    });
};

const requestWindowClose = (window: BrowserWindow, quit: boolean): void => {
    if (window.isDestroyed()) return;
    const request = requests.get(window);
    if (request) request(quit);
    else window.webContents.send(Channel.SIYUAN_SAVE_CLOSE, quit);
};

export {installWindowCloseRecovery, requestWindowClose};
