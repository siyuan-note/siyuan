class WindowWorkspaceRegistry {
    constructor() {
        this.windows = new Map();
        this.observed = new WeakSet();
    }

    get(origin, id) {
        const key = `${origin}\n${id}`;
        const window = this.windows.get(key);
        if (window?.isDestroyed()) {
            this.windows.delete(key);
            return;
        }
        return window;
    }

    associate(window, origin, id) {
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

    release(window) {
        for (const [key, value] of this.windows) {
            if (value === window) {
                this.windows.delete(key);
            }
        }
    }

    list(origin) {
        return [...this.windows].filter(([key, window]) => key.startsWith(`${origin}\n`) && !window.isDestroyed())
            .map(([key]) => key.slice(origin.length + 1));
    }
}

let saveRequestID = 0;

// 退出工作空间前等待窗口布局保存完成，超时或写入失败时保留窗口。
const flushWindowWorkspaces = (windows, ipcMain, timeoutMs = 11000) => {
    const contents = windows.filter(window => !window.isDestroyed()).map(window => window.webContents);
    if (!contents.length) {
        return Promise.resolve(true);
    }
    return new Promise(resolve => {
        const id = ++saveRequestID;
        const pending = new Set(contents.map(content => content.id));
        const finish = saved => {
            clearTimeout(timeout);
            ipcMain.removeListener("siyuan-window-workspace-saved", onSaved);
            resolve(saved);
        };
        const onSaved = (event, response) => {
            if (response?.id !== id || event.senderFrame !== event.sender.mainFrame || !pending.has(event.sender.id)) {
                return;
            }
            pending.delete(event.sender.id);
            if (response.saved !== true) {
                finish(false);
            } else if (!pending.size) {
                finish(true);
            }
        };
        const timeout = setTimeout(() => finish(false), timeoutMs);
        ipcMain.on("siyuan-window-workspace-saved", onSaved);
        contents.forEach(content => {
            try {
                content.send("siyuan-send-windows", {cmd: "siyuan-window-workspace-flush", data: id});
            } catch {
                finish(false);
            }
        });
    });
};

module.exports = {WindowWorkspaceRegistry, flushWindowWorkspaces};
