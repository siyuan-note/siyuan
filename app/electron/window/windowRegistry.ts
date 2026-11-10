// 窗口账本的读写集中在本模块：按 webContents id 索引内核目标、握手与初始化状态、崩溃预期与最近活动窗口。
// `runtime.state.windows` 只在 `shared/runtime.ts` 的初始化与重置中直接赋值，其余模块一律走这里的函数。
import {state} from "../shared/runtime";
import {BrowserWindow} from "electron";
import type {BootWindow, KernelTarget, Workspace} from "../shared/types";

const ledger = () => state.windows;

/** 窗口完成内核能力领取（`siyuan-init`），此后重复初始化只刷新托盘文案。 */
const markWindowInitialized = (webContentsId: number): void => {
    ledger().initialized.add(webContentsId);
};

const isWindowInitialized = (webContentsId: number): boolean => ledger().initialized.has(webContentsId);

const forgetWindowInitialized = (webContentsId: number): void => {
    ledger().initialized.delete(webContentsId);
};

/** 首次 `siyuan-event` 握手后即可接收业务消息。 */
const markHandshaken = (webContentsId: number): void => {
    ledger().handshaken.add(webContentsId);
};

const isHandshaken = (webContentsId: number): boolean => ledger().handshaken.has(webContentsId);

const forgetHandshaken = (webContentsId: number): void => {
    ledger().handshaken.delete(webContentsId);
};

/** 标记窗口退出是预期的，崩溃处理据此跳过上报。 */
const markExpectedRendererExitId = (webContentsId: number): void => {
    ledger().expectedRendererExit.add(webContentsId);
};

/** 取出并清除预期退出标记；崩溃处理只消费一次。 */
const takeExpectedRendererExit = (webContentsId: number): boolean =>
    ledger().expectedRendererExit.delete(webContentsId);

const setWindowKernelTarget = (webContentsId: number, target: KernelTarget): void => {
    ledger().targets.set(webContentsId, target);
};

/** 窗口所属的内核目标，未登记的窗口返回 undefined。 */
const getWindowKernelTarget = (webContentsId: number): KernelTarget | undefined =>
    ledger().targets.get(webContentsId);

/** 属于指定内核并已完成初始化的窗口，按打开顺序返回。 */
const getInitializedWindows = (origin: string): BrowserWindow[] =>
    BrowserWindow.getAllWindows().filter(win =>
        isWindowInitialized(win.webContents.id) &&
        getWindowKernelTarget(win.webContents.id)?.origin === origin);

const forgetKernelTarget = (webContentsId: number): void => {
    ledger().targets.delete(webContentsId);
};

/** 记录最近获得焦点的窗口，供无法直接取焦点窗口的调用方回退。 */
const markActiveWindow = (window: BrowserWindow): void => {
    state.windows.activeWindow = window;
};

const getActiveWindow = (): BrowserWindow | undefined => state.windows.activeWindow;

const getBootWindows = (): Set<BootWindow> => ledger().bootWindows;

const addBootWindow = (window: BootWindow): void => {
    ledger().bootWindows.add(window);
};

const removeBootWindow = (window: BootWindow): void => {
    ledger().bootWindows.delete(window);
};

const getCurrentBootWindow = (): BootWindow | undefined => ledger().currentBoot;

const setCurrentBootWindow = (window: BootWindow | undefined): void => {
    ledger().currentBoot = window;
};

const addWorkspace = (workspace: Workspace): void => {
    state.workspaces.push(workspace);
};

/** 返回该工作空间原本是否在账本中。 */
const removeWorkspace = (workspace: Workspace): boolean => {
    const index = state.workspaces.indexOf(workspace);
    if (index < 0) {
        return false;
    }
    state.workspaces.splice(index, 1);
    return true;
};

/** 按 webContents id 取回工作空间记录。 */
const findWorkspaceByWebContents = (webContentsId: number): Workspace | undefined =>
    state.workspaces.find(item => item.webContentsId === webContentsId);

export {
    markWindowInitialized,
    isWindowInitialized,
    forgetWindowInitialized,
    markHandshaken,
    isHandshaken,
    forgetHandshaken,
    markExpectedRendererExitId,
    takeExpectedRendererExit,
    setWindowKernelTarget,
    getWindowKernelTarget,
    getInitializedWindows,
    forgetKernelTarget,
    markActiveWindow,
    getActiveWindow,
    getBootWindows,
    addBootWindow,
    removeBootWindow,
    getCurrentBootWindow,
    setCurrentBootWindow,
    addWorkspace,
    removeWorkspace,
    findWorkspaceByWebContents,
};
