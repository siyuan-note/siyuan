const fs = require("node:fs/promises");
const path = require("node:path");

// 主进程直接请求本地内核，窗口关闭或访问会话退出后仍可锁定，认证材料只从本地配置读取。
const createNotebookSystemLock = ({getWorkspaces, fetch, writeLog, prepare = async () => {}, readFile = fs.readFile}) => {
    const pending = new Map();
    const running = new Map();
    const request = (workspace) => {
        const origin = workspace.kernelTarget.origin;
        if (running.has(origin)) {
            return running.get(origin);
        }
        pending.set(origin, workspace);
        const task = (async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const config = JSON.parse(await readFile(path.join(workspace.workspaceDir, "conf", "conf.json"), "utf8"));
                if (!config.system?.encryptedNotebookFollowSystemLock) {
                    pending.delete(origin);
                    return;
                }
                try {
                    await prepare(workspace);
                } catch {
                    writeLog("encrypted notebook editor preparation failed; continue system lock");
                }
                const headers = {"Content-Type": "application/json"};
                if (config.api?.token) {
                    headers.Authorization = "Token " + config.api.token;
                } else if (config.accessAuthCode) {
                    headers.Authorization = "Basic " + Buffer.from(path.basename(workspace.workspaceDir) + ":" + config.accessAuthCode).toString("base64");
                }
                const response = await fetch(origin + "/api/notebook/lockEncryptedNotebooksOnSystemLock", {
                    method: "POST",
                    headers,
                    body: "{}",
                    credentials: "omit",
                    redirect: "error",
                    signal: controller.signal,
                });
                if (!response.ok || (await response.json()).code !== 0) {
                    throw new Error("request rejected");
                }
                pending.delete(origin);
            } catch {
                // 不记录异常原文，避免请求和配置中的认证信息进入日志。
                writeLog("encrypted notebook system lock failed; retry on system unlock or resume");
            } finally {
                clearTimeout(timeout);
                running.delete(origin);
            }
        })();
        running.set(origin, task);
        return task;
    };
    const localWorkspaces = () => getWorkspaces().filter(workspace =>
        workspace.ownsKernel && workspace.workspaceDir && workspace.kernelTarget?.origin);
    return {
        lock: () => Promise.all(localWorkspaces().map(request)),
        retry: async () => {
            // 系统可能在请求完成前休眠；恢复后等待在途请求，再重试未成功的本地工作空间。
            await Promise.all(running.values());
            const workspaces = localWorkspaces();
            for (const origin of pending.keys()) {
                if (!workspaces.some(workspace => workspace.kernelTarget.origin === origin)) {
                    pending.delete(origin);
                }
            }
            await Promise.all(workspaces.filter(workspace => pending.has(workspace.kernelTarget.origin)).map(request));
        },
    };
};

let preparationID = 0;

// 等待各窗口提交输入，但不让无响应窗口无限阻止内核锁定。
const prepareNotebookSystemLock = (windows, ipcMain) => new Promise(resolve => {
    const id = ++preparationID;
    const contents = windows.filter(window => !window.isDestroyed()).map(window => window.webContents);
    const pending = new Set(contents.map(content => content.id));
    const finish = () => {
        clearTimeout(timeout);
        ipcMain.removeListener("siyuan-notebook-system-lock-ready", onReady);
        resolve();
    };
    const onReady = (event, requestID) => {
        if (requestID !== id || event.senderFrame !== event.sender.mainFrame) {
            return;
        }
        pending.delete(event.sender.id);
        if (pending.size === 0) {
            finish();
        }
    };
    const timeout = setTimeout(finish, 1000);
    ipcMain.on("siyuan-notebook-system-lock-ready", onReady);
    contents.forEach(content => {
        const contentID = content.id;
        try {
            content.send("siyuan-send-windows", {cmd: "prepareNotebookSystemLock", data: id});
        } catch {
            pending.delete(contentID);
        }
    });
    if (pending.size === 0) {
        finish();
    }
});

module.exports = {createNotebookSystemLock, prepareNotebookSystemLock};
