// 窗口间消息（siyuan-send-windows）的授权与投递规则。渲染进程只能发送本表列出的命令，
// 主进程内部通知（如 lockscreenByMode）不在此列，因此任何渲染进程都无法伪造。
const rendererWindowCommands = new Set(["closetab", "setTabDragData", "resetTabsStyle"]);

const isRendererWindowCommand = (data) => {
    if (!data || typeof data !== "object" || typeof data.cmd !== "string") {
        return false;
    }
    if (!rendererWindowCommands.has(data.cmd)) {
        return false;
    }
    return data.cmd === "setTabDragData" ? !!data.data && typeof data.data === "object" : typeof data.data === "string";
};

// 仅允许同工作区窗口之间投递：发送方必须是已登记的窗口，收件方必须与发送方指向同一内核目标。
// 这样远端内核窗口无法影响其它工作区，本地发送方也无法影响另一个工作区
const dispatchWindowMessage = (data, options) => {
    const {senderWebContentsId, getKernelTarget, getAllWindows} = options;
    if (!isRendererWindowCommand(data)) {
        return false;
    }
    const senderTarget = getKernelTarget(senderWebContentsId);
    if (!senderTarget) {
        return false;
    }
    getAllWindows().forEach((window) => {
        if (window.isDestroyed()) {
            return;
        }
        const webContentsId = window.webContents.id;
        if (webContentsId === senderWebContentsId) {
            return;
        }
        const target = getKernelTarget(webContentsId);
        if (!target || target.origin !== senderTarget.origin) {
            return;
        }
        window.webContents.send("siyuan-send-windows", data);
    });
    return true;
};

module.exports = {dispatchWindowMessage};
