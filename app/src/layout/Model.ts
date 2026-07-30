import {Constants} from "../constants";
/// #if !MOBILE
import type {Tab} from "./Tab";
/// #endif
import type {App} from "../index";
import {kernelError} from "../util/kernelFault";
import {processMessage} from "../util/processMessage";
import {reloadSync} from "../util/reloadSync";

interface IConnectOptions {
    id: string,
    type?: TWS,
    callback?: () => void,
    msgCallback?: (data: IWebSocketData) => void
}

export class Model {
    public ws: WebSocket;
    public reqId: number;
    private mainMessageQueue: {
        data: string,
        callback: (data: IWebSocketData) => void
    }[] = [];

    public parent:

        /// #if !MOBILE
        Tab;
    /// #else
    // @ts-ignore
    null;
    /// #endif
    public app: App;

    constructor(options: {
        app: App,
    }) {
        this.app = options.app;
    }

    private processWebSocketMessage(data: string, callback: (data: IWebSocketData) => void) {
        callback.call(this, processMessage(JSON.parse(data)));
    }

    public flushMainMessages() {
        const messages = this.mainMessageQueue.splice(0);
        messages.forEach((message) => {
            try {
                this.processWebSocketMessage(message.data, message.callback);
            } catch (error) {
                console.error("Failed to process queued WebSocket message:", error);
            }
        });
    }

    public connect(options: IConnectOptions) {
        const websocketURL = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
        const ws = new WebSocket(`${websocketURL}?app=${Constants.SIYUAN_APPID}&id=${options.id}${options.type ? "&type=" + options.type : ""}`);
        ws.onopen = () => {
            if (options.callback) {
                options.callback.call(this);
            }
            const logElement = document.getElementById("errorLog");
            if (logElement) {
                // 内核中断后无法 catch fetch 请求错误，重连会导致无法执行 transactionsTimeout
                reloadSync(this.app, {upsertRootIDs: [], removeRootIDs: []});
                window.siyuan.dialogs.find(item => {
                    if (item.element.id === "errorLog") {
                        item.destroy();
                        return true;
                    }
                });
            }
        };
        ws.onmessage = (event) => {
            if (!options.msgCallback) {
                return;
            }
            if (options.type === "main" && !window.siyuan.isReady) {
                this.mainMessageQueue.push({
                    data: event.data,
                    callback: options.msgCallback,
                });
                return;
            }
            // 非主 WebSocket 在界面初始化后创建，保留配置保护以避免异常连接提前处理消息。
            if (window.siyuan.config) {
                this.processWebSocketMessage(event.data, options.msgCallback);
            }
        };
        ws.onclose = (ev) => {
            if (0 <= ev.reason.indexOf("unauthenticated")) {
                return;
            }

            if (0 > ev.reason.indexOf("close websocket")) {
                console.warn("WebSocket is closed. Reconnect will be attempted in 3 second.", ev);
                setTimeout(() => {
                    this.connect({
                        id: options.id,
                        type: options.type,
                        msgCallback: options.msgCallback
                    });
                }, 3000);
            }
        };
        ws.onerror = (err: Event & { target: { url: string, readyState: number } }) => {
            if (err.target.url.endsWith("&type=main") && err.target.readyState === 3) {
                kernelError();
            }
        };
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
        }
        this.ws = ws;
    }

    public send(cmd: string, param: Record<string, unknown>, process = false) {
        if (!this.ws ||
            this.ws.readyState === WebSocket.CLOSING ||
            this.ws.readyState === WebSocket.CLOSED) { // Inbox 无 WebSocket，关闭中的连接不能继续发送
            return;
        }
        this.reqId = process ? 0 : Date.now();
        this.ws.send(JSON.stringify({
            cmd,
            reqId: this.reqId,
            param,
            // pushMode
            // 0: 所有应用所有会话广播
            // 1：自我应用会话单播
            // 2：非自我会话广播
            // 4：非自我应用所有会话广播
            // 5：单个应用内所有会话广播
            // 6：非自我应用主会话广播
        }));
    }
}
