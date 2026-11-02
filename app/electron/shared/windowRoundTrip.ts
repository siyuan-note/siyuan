// 主进程向一组窗口广播同一个请求并收齐回执：按请求序号过滤迟到的旧回执，只接受主框架发出的那一条。
// 返回 true 表示所有窗口都已确认；超时、任一窗口未确认或发送失败时返回 false。
import * as electron from "electron";
import {Channel} from "./channels";
import type {BrowserWindow, IpcMainEvent} from "electron";

type WindowRoundTripOptions = {
    /** 参与本次广播的窗口；已销毁的窗口不计入。 */
    windows: BrowserWindow[];
    /** 回执通道名。 */
    channel: string;
    /** 广播命令名，请求序号放在 data 里。 */
    command: string;
    timeoutMs: number;
    /** 从回执载荷取出请求序号；返回 undefined 表示这条回执与本轮无关。 */
    readRequestID: (payload: unknown) => number | undefined;
    /** 该窗口是否已完成；默认只要序号匹配即算完成。 */
    isAccepted?: (payload: unknown) => boolean;
    /** 发送失败时只放弃该窗口，而不是判定整轮失败。 */
    skipFailedPeer?: boolean;
};

// 请求序号全进程递增：各自只监听自己的回执通道，因此共用一个计数器不会串轮次。
let roundTripID = 0;

const requestFromWindows = ({windows, channel, command, timeoutMs,
    readRequestID, isAccepted = () => true, skipFailedPeer = false}: WindowRoundTripOptions): Promise<boolean> =>
    new Promise<boolean>(resolve => {
        const contents = windows.filter((window: BrowserWindow) => !window.isDestroyed()).map(window => window.webContents);
        const id = ++roundTripID;
        const pending = new Set<number>(contents.map(content => content.id));
        const finish = (confirmed: boolean): void => {
            clearTimeout(timer);
            electron.ipcMain.removeListener(channel, onReply);
            resolve(confirmed);
        };
        // 子帧、上一轮的迟到回执与重复回执都不能结束本轮。
        const onReply = (event: IpcMainEvent, payload: unknown): void => {
            if (readRequestID(payload) !== id || event.senderFrame !== event.sender.mainFrame ||
                !pending.has(event.sender.id)) {
                return;
            }
            pending.delete(event.sender.id);
            if (!isAccepted(payload)) {
                finish(false);
            } else if (!pending.size) {
                finish(true);
            }
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        electron.ipcMain.on(channel, onReply);
        for (const content of contents) {
            try {
                content.send(Channel.SIYUAN_SEND_WINDOWS, {cmd: command, data: id});
            } catch {
                if (!skipFailedPeer) {
                    finish(false);
                    return;
                }
                pending.delete(content.id);
            }
        }
        if (!pending.size) {
            finish(true);
        }
    });

export {requestFromWindows};
