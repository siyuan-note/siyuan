// `siyuan-cmd` 通道：渲染进程发来的窗口与桌面能力命令。
// 所有命令都登记在同一张表里，新增命令只需增加一个表项；需要前置校验的命令在校验不通过时直接返回。
import * as electron from "electron";
import {state, writeLog} from "../shared/runtime";
import {WINDOW_PAGE} from "../shared/pagePaths";
import {getWindowByContentId} from "../window/windowLookup";
import {showWindow} from "../window/windowVisibility";
import {updateTitleBarOverlay} from "../window/windowControlsOverlay";
import {openDevTools, toggleDevTools} from "../window/devToolsDock";
import {hotKey2Electron} from "../window/appMenu";
import {findWorkspaceByWebContents, getWindowKernelTarget} from "../window/windowRegistry";
import type {BrowserWindow, WebContents} from "electron";
import type {Workspace} from "../shared/types";
import {Channel} from "../shared/channels";

/** 一条命令执行时可见的上下文。载荷形状随命令变化，由各命令自行解释。 */
type CommandContext = {
    /** 命令载荷。以字符串形式发送的命令没有载荷，读取字段得到 undefined。 */
    data: Record<string, any>;
    /** 执行命令的窗口；窗口已关闭或 id 无法解析时为 undefined。 */
    window: BrowserWindow | undefined;
    sender: WebContents;
    /** 发送方属于远程内核窗口，本机文件与剪贴板能力对它关闭。 */
    remoteSender: boolean;
    /** 载荷未指向其他窗口，且发送方处于主框架。 */
    isSenderMainFrame: boolean;
};

type CommandHandler = (context: CommandContext) => void;

// 全局快捷键切换窗口后，Windows 与 Linux 的托盘菜单文案需要随可见状态刷新。
const getActiveWorkspace = (fallbackWorkspace?: Workspace): Workspace | undefined => {
    const focusedWorkspace = state.workspaces.find(item => item.browserWindow &&
        !item.browserWindow.isDestroyed() && item.browserWindow.isFocused());
    if (focusedWorkspace) {
        return focusedWorkspace;
    }
    if (fallbackWorkspace?.browserWindow && !fallbackWorkspace.browserWindow.isDestroyed()) {
        return fallbackWorkspace;
    }
};

const registerGlobalShortcut = ({data, sender}: CommandContext): void => {
    const workspaceItem = findWorkspaceByWebContents(sender.id);
    if (!workspaceItem || !data.accelerator) {
        return;
    }
    const accelerator = hotKey2Electron(data.accelerator);
    if (!accelerator) {
        return;
    }
    electron.globalShortcut.unregister(accelerator);
    electron.globalShortcut.register(accelerator, () => {
        const targetWorkspace = getActiveWorkspace(workspaceItem);
        if (targetWorkspace) {
            targetWorkspace.browserWindow.webContents.send(Channel.SIYUAN_HOTKEY, {hotkey: data.accelerator});
        }
    });
};

const commands: Record<string, CommandHandler> = {
    // 只作用于窗口自身的命令：窗口已不可用时静默跳过。
    hide: ({window}) => window?.hide(),
    minimize: ({window}) => window?.minimize(),
    maximize: ({window}) => window?.maximize(),
    focus: ({window}) => window?.focus(),
    destroy: ({window}) => window?.destroy(),
    restore: ({window}) => {
        if (!window) {
            return;
        }
        if (window.isFullScreen()) {
            window.setFullScreen(false);
        } else {
            window.unmaximize();
        }
    },
    setAlwaysOnTopFalse: ({window}) => window?.setAlwaysOnTop(false),
    // Windows 置顶窗口使用不受任务栏后置限制的级别。
    setAlwaysOnTopTrue: ({window}) => window?.setAlwaysOnTop(true,
        "win32" === process.platform ? "pop-up-menu" : "floating"),
    closeButtonBehavior: ({window}) => {
        if (!window) {
            return;
        }
        if (window.isFullScreen()) {
            window.once("leave-full-screen", () => {
                window.hide();
            });
            window.setFullScreen(false);
        } else {
            window.hide();
        }
    },

    show: ({window}) => showWindow(window),
    showItemInFolder: ({data, remoteSender}) => {
        if (remoteSender) {
            writeLog("ignored showing a server path in remote kernel mode");
            return;
        }
        electron.shell.showItemInFolder(data.filePath);
    },
    openPath: ({data, remoteSender}) => {
        if (remoteSender) {
            writeLog("ignored opening a server path in remote kernel mode");
            return;
        }
        electron.shell.openPath(data.filePath);
    },
    notification: ({data, window}) => {
        const notification = new electron.Notification({
            title: data.title,
            body: data.body,
            timeoutType: data.timeoutType,
        });
        notification.on("click", () => {
            window?.focus();
            window?.show();
        });
        notification.show();
    },
    setSpellCheckerLanguages: ({data}) => {
        electron.BrowserWindow.getAllWindows().forEach(item => {
            item.webContents.session.setSpellCheckerLanguages(data.languages);
        });
    },
    openDevTools: ({sender, data}) => openDevTools(sender, process.platform, data),
    toggleDevTools: ({sender}) => toggleDevTools(sender),
    unregisterGlobalShortcut: ({data, sender}) => {
        if (!findWorkspaceByWebContents(sender.id) || !data.accelerator) {
            return;
        }
        const accelerator = hotKey2Electron(data.accelerator);
        if (accelerator) {
            electron.globalShortcut.unregister(accelerator);
        }
    },
    registerGlobalShortcut,
    setTitleBarOverlay: ({data, window, isSenderMainFrame}) => {
        if (window && isSenderMainFrame) {
            updateTitleBarOverlay(window, data);
        }
    },
    setTrafficLightPosition: ({data, window}) => {
        if (!window || !window.setWindowButtonPosition) {
            return;
        }
        if (new URL(window.webContents.getURL()).pathname === WINDOW_PAGE) {
            data.position.y += 5 * data.zoom;
        }
        window.setWindowButtonPosition(data.position);
    },
    clearCache: ({sender}) => {
        sender.session.clearCache();
    },
    redo: ({sender}) => sender.redo(),
    undo: ({sender}) => sender.undo(),
    writeLog: ({data}) => writeLog(data.msg),
};

const registerCommandIpc = (): void => {
    electron.ipcMain.on(Channel.SIYUAN_CMD, (event, data) => {
        const payload: Record<string, any> = data;
        let cmd = data;
        let webContentsId = event.sender.id;
        if (typeof data !== "string") {
            cmd = data.cmd;
            if (data.webContentsId) {
                webContentsId = data.webContentsId;
            }
        }
        const handler = commands[cmd];
        if (!handler) {
            return;
        }
        handler({
            data: payload,
            window: getWindowByContentId(webContentsId),
            sender: event.sender,
            remoteSender: getWindowKernelTarget(event.sender.id)?.mode === "remote",
            // 载荷借用了其他窗口时不代表发送方自己，主题与标题栏只按发送方主框架生效。
            isSenderMainFrame: event.senderFrame === event.sender.mainFrame && webContentsId === event.sender.id,
        });
    });
};

export {registerCommandIpc};
