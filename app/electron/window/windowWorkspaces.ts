import type {BrowserWindow} from "electron";
import {requestFromWindows} from "../shared/windowRoundTrip";
import {Channel} from "../shared/channels";

class WindowWorkspaceRegistry {
    declare windows: Map<string, BrowserWindow>;
    declare observed: WeakSet<BrowserWindow>;

    constructor() {
        this.windows = new Map();
        this.observed = new WeakSet();
    }

    get(origin: string, id: string): BrowserWindow | undefined {
        const key = `${origin}\n${id}`;
        const window = this.windows.get(key);
        if (window?.isDestroyed()) {
            this.windows.delete(key);
            return;
        }
        return window;
    }

    associate(window: BrowserWindow | null | undefined, origin: string, id: string): boolean {
        if (!window || window.isDestroyed() || !origin ||
            (id !== "" && (typeof id !== "string" || !/^\d{14}-[a-z0-9]{7}$/.test(id)))) {
            return false;
        }
        const existing = id && this.get(origin, id);
        if (existing && existing !== window) {
            return false;
        }
        this.release(window);
        if (id) {
            this.windows.set(`${origin}\n${id}`, window);
        }
        if (!this.observed.has(window)) {
            this.observed.add(window);
            window.once("closed", () => this.release(window));
        }
        return true;
    }

    release(window: BrowserWindow): void {
        for (const [key, value] of this.windows) {
            if (value === window) {
                this.windows.delete(key);
            }
        }
    }

    list(origin: string): string[] {
        return [...this.windows].filter(([key, window]) => key.startsWith(`${origin}\n`) && !window.isDestroyed())
            .map(([key]) => key.slice(origin.length + 1));
    }
}

// 退出工作空间前等待窗口布局保存完成，任一窗口未保存、窗口无响应或发送失败都保留窗口。
const flushWindowWorkspaces = (windows: BrowserWindow[], timeoutMs = 11000): Promise<boolean> =>
    requestFromWindows({
        windows,
        channel: Channel.SIYUAN_WINDOW_WORKSPACE_SAVED,
        command: Channel.SIYUAN_WINDOW_WORKSPACE_FLUSH,
        timeoutMs,
        readRequestID: payload => (payload as {id?: number} | undefined)?.id,
        isAccepted: payload => (payload as {saved?: boolean}).saved === true,
    });

// 独立文档窗口的归属登记全进程只有一份，直接由本模块持有。
const windowWorkspaces = new WindowWorkspaceRegistry();

export {WindowWorkspaceRegistry, windowWorkspaces, flushWindowWorkspaces};
