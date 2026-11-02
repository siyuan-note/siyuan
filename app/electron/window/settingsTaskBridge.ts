import * as electron from "electron";
import type {
    BrowserWindow,
    IpcMainEvent,
    IpcMainInvokeEvent,
    WebContents,
} from "electron";
import {getInitializedWindows, getWindowKernelTarget} from "./windowRegistry";
import type {KernelTarget} from "../shared/types";
import {Channel} from "../shared/channels";

type SettingsTask = {
    id: string;
    owner: WebContents;
    blockedWindows: Set<BrowserWindow>;
    pending: Set<number>;
    resolve: (id: string) => void;
    reject: (error: Error) => void;
    close: () => void;
    timer?: NodeJS.Timeout;
};

// 维护任务先阻塞同一内核的原生窗口并提交待保存输入，任一窗口失败时取消任务。
const createSettingsTaskBridge = ({getTarget = getWindowKernelTarget,
    getWindows = getInitializedWindows}: {
        getTarget?: (webContentsId: number) => KernelTarget | undefined;
        getWindows?: (origin: string) => BrowserWindow[];
    } = {}): void => {
    const tasks = new Map<string, SettingsTask>();
    const disabled = new Map<BrowserWindow, {count: number; enabled: boolean}>();
    let sequence = 0;
    const finish = (task: SettingsTask): void => {
        if (!tasks.delete(task.id)) return;
        clearTimeout(task.timer);
        task.owner.removeListener("destroyed", task.close);
        for (const win of task.blockedWindows) {
            const state = disabled.get(win);
            if (state && --state.count === 0) {
                disabled.delete(win);
                if (!win.isDestroyed()) win.setEnabled(state.enabled);
            }
            if (!win.isDestroyed()) {
                win.webContents.send(Channel.SIYUAN_SEND_WINDOWS, {cmd: "endSettingTask", data: task.id});
            }
        }
    };
    electron.ipcMain.on(Channel.SIYUAN_SETTINGS_TASK_READY, (event: IpcMainEvent, data: {id?: string; saved?: boolean}) => {
        const task = tasks.get(data?.id as string);
        if (!task || event.senderFrame !== event.sender.mainFrame || !task.pending.has(event.sender.id)) return;
        if (data.saved !== true) {
            finish(task);
            task.reject(new Error("Could not save pending editor input"));
            return;
        }
        task.pending.delete(event.sender.id);
        if (!task.pending.size) {
            clearTimeout(task.timer);
            task.resolve(task.id);
        }
    });
    electron.ipcMain.handle(Channel.SIYUAN_SETTINGS_TASK_START, (event: IpcMainInvokeEvent) => {
        const target = getTarget(event.sender.id);
        if (!target || event.senderFrame !== event.sender.mainFrame) throw new Error("Unregistered settings task sender");
        const windows = getWindows(target.origin).filter((win: BrowserWindow) => !win.isDestroyed());
        if (!windows.some((win: BrowserWindow) => win.webContents.id === event.sender.id)) throw new Error("Settings window is not initialized");
        return new Promise<string>((resolve, reject) => {
            const id = "native-" + (++sequence);
            const task: SettingsTask = {
                id,
                owner: event.sender,
                blockedWindows: new Set<BrowserWindow>(),
                pending: new Set<number>(windows.map((win: BrowserWindow) => win.webContents.id)),
                resolve,
                reject,
                close: () => {},
            };
            task.close = () => { finish(task); reject(new Error("Settings task owner closed")); };
            task.timer = setTimeout(() => { finish(task); reject(new Error("Editor preparation timed out")); }, 10000);
            tasks.set(id, task);
            event.sender.once("destroyed", task.close);
            try {
                for (const win of windows) {
                    const state = disabled.get(win) || {count: 0, enabled: win.isEnabled()};
                    state.count++;
                    disabled.set(win, state);
                    task.blockedWindows.add(win);
                    win.setEnabled(false);
                    win.webContents.send(Channel.SIYUAN_SEND_WINDOWS, {cmd: "prepareSettingTask", data: id});
                }
            } catch (error) {
                finish(task);
                reject(error);
            }
        });
    });
    electron.ipcMain.handle(Channel.SIYUAN_SETTINGS_TASK_END, (event: IpcMainInvokeEvent, id: string) => {
        const task = tasks.get(id);
        if (task?.owner === event.sender && event.senderFrame === event.sender.mainFrame) finish(task);
    });
};

export {createSettingsTaskBridge};
