import {fetchSyncPost} from "../util/fetch";

export class Kernel implements IKernelPlugin {
    public state: IKernelPluginState;
    public rpc: IKernelPluginRpc;

    /**
     * 内核插件所属的应用 ID，用于区分不同应用的内核插件，建立 WebSocket 连接时会携带该 ID，以便内核正确路由消息
     */
    #appId: string;

    /**
     * 内核插件的名称，必须与内核插件注册时使用的名称一致，用于建立 WebSocket 连接和接收通知
     */
    #name: string;

    /**
     * JSON RPC WebSocket 连接，用于接收内核插件通知类型的 RPC 调用
     *
     * 普通的 RPC 调用使用 POST 请求
     */
    #rpcWs: WebSocket | null;

    /**
     * 内核插件通知类型的 RPC 调用的处理函数
     */
    #handlers: Map<TJsonRpcMethod, Set<TJsonRpcHandler<void>>>;

    #rpcCallUrl: string;

    constructor(
        appId: string,
        name: string,
    ) {
        this.#appId = appId;
        this.#name = name;
        this.#handlers = new Map();
        this.#rpcWs = null;
        this.#rpcCallUrl = this.#createJsonRpcCallUrl();

        this.state = this.#createState();
        this.rpc = this.#createRpc();
    }

    #createState(): IKernelPluginState {
        return new KernelState((state) => {
            switch (state) {
                case 3: // running
                    if (this.#rpcWs == null) {
                        this.#rpcWs = this.#createJsonRpcWebSocket();
                        break;
                    }

                    switch (this.#rpcWs.readyState) {
                        case WebSocket.CONNECTING:
                        case WebSocket.OPEN:
                            // 内核插件正在运行，且 WebSocket 连接已建立或正在建立，无需处理
                            break;
                        case WebSocket.CLOSING:
                        case WebSocket.CLOSED:
                            // 内核插件已在运行，但 WebSocket 连接未建立或已断开，尝试重新建立连接
                            this.#rpcWs = this.#createJsonRpcWebSocket();
                            break;
                    }
                    break;
            }
        });
    }

    #createRpc(): IKernelPluginRpc {
        const self = this;

        const call = new Proxy({} as Record<TJsonRpcMethod, (...args: TJsonRpcMethodParams) => Promise<any>>, {
            get(_target, method: string) {
                return (...args: TJsonRpcMethodParams) => self.#rpcCall(method, ...args);
            }
        });

        const notify = new Proxy({} as Record<TJsonRpcMethod, (...args: TJsonRpcMethodParams) => void>, {
            get(_target, method: string) {
                return (...args: TJsonRpcMethodParams) => self.#rpcNotify(method, ...args);
            }
        });

        return {
            call,
            notify,
            batch: self.#rpcBatchCall.bind(self),
            bind: (method: TJsonRpcMethod, handler: TJsonRpcHandler<void>) => {
                const handlers = (() => {
                    let handlers = self.#handlers.get(method);
                    if (!handlers) {
                        handlers = new Set();
                        self.#handlers.set(method, handlers);
                    }
                    return handlers;
                })();
                handlers.add(handler);
            },
            unbind: (method: TJsonRpcMethod, handler: TJsonRpcHandler<void>) => {
                const handlers = self.#handlers.get(method);
                if (handlers) {
                    handlers.delete(handler);
                    if (handlers.size === 0) {
                        self.#handlers.delete(method);
                    }
                }
            },
        };
    }

    #createJsonRpcWebSocket() {
        const websocketURL = new URL(window.location.origin);
        websocketURL.protocol = websocketURL.protocol === "https:" ? "wss:" : "ws:";
        websocketURL.pathname = "/ws/plugin/rpc";
        websocketURL.searchParams.set("name", this.#name);
        const ws = new WebSocket(websocketURL);
        ws.addEventListener("message", (event) => {
            const message = JSON.parse(event.data);
            // JSON-RPC 通知：无 id 字段，有 method 字段
            if (message.method && message.id === undefined) {
                const handlers = this.#handlers.get(message.method);
                if (handlers) {
                    const params = Array.isArray(message.params) ? message.params : [message.params];
                    handlers.forEach(async handler => {
                        try {
                            await handler(...params);
                        } catch (error) {
                            console.error(`Error handling JSON-RPC notification for method ${message.method}:`, error);
                        }
                    });
                }
            }
        });
        return ws;
    }

    #createJsonRpcCallUrl() {
        const searchParams = new URLSearchParams({ name: this.#name, appId: this.#appId });
        return `api/plugin/rpc?${searchParams.toString()}`;
    }

    #generateId(): TJsonRpcId {
        return Lute.NewNodeID();
    }

    async #initState() {
        const response = await fetchSyncPost("api/plugin/getLoadedPlugin", { name: this.#name });
        if (this.state.code === -1 && response.data?.stateCode != null) {
            this.state.code = response.data.stateCode;
        }
    }

    async #rpcCall(method: TJsonRpcMethod, ...params: TJsonRpcMethodParams): Promise<any> {
        const id = this.#generateId();

        const response = await fetch(this.#rpcCallUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        });

        const data = await response.json();
        if (data.error) {
            throw new JsonRpcError(data.error);
        }
        return data.result;
    }

    #rpcNotify(method: TJsonRpcMethod, ...params: TJsonRpcMethodParams): void {
        fetch(this.#rpcCallUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method, params }),
        });
    }

    async #rpcBatchCall(...calls: IKernelPluginRpcCall[]): Promise<IKernelPluginRpcError | (IKernelPluginRpcResultResponse | IKernelPluginRpcErrorResponse)[]> {
        const requests = calls.map(call => {
            const request: IKernelPluginRpcRequest = { jsonrpc: "2.0", method: call.method };
            if (call.params != null) {
                request.params = call.params;
            }
            if (!call.notification) {
                request.id = call.id ?? this.#generateId();
            }
            return request;
        });

        const response = await fetch(this.#rpcCallUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requests),
        });

        const data = await response.json();
        return data;
    }

    public async init() {
        try {
            await this.#initState();
        } catch (error) {
            console.error("Failed to initialize kernel plugin state:", error);
        }
    }

    public async destroy() {
        try {
            this.#rpcWs?.close();
        } catch (error) {
            console.error("Failed to close JSON-RPC WebSocket connection:", error);
        }
    }
}

export class KernelState implements IKernelPluginState {
    #state: TKernelPluginState = -1;
    #description: string = "inactive";

    #onchange: ((state: TKernelPluginState) => void);

    public onchange: ((state: TKernelPluginState) => void) | null = null;

    constructor(onchange: ((state: TKernelPluginState) => void)) {
        this.#onchange = onchange;
    }

    set code(state: TKernelPluginState) {
        this.#state = state;
        this.#description = (() => {
            switch (state) {
                case -1:
                    return "inactive";
                case 0:
                    return "ready";
                case 1:
                    return "loading";
                case 2:
                    return "loaded";
                case 3:
                    return "running";
                case 4:
                    return "stopping";
                case 5:
                    return "stopped";
                case 6:
                    return "error";
                default:
                    return "unknown";
            }
        })();

        this.#onchange(state);

        try {
            this.onchange?.(state);
        } catch (error) {
            console.error("Error in kernel plugin state onchange handler:", error);
        }
    }

    get code() {
        return this.#state;
    }

    get description() {
        return this.#description;
    }
}

export class JsonRpcError extends Error implements IKernelPluginRpcError {
    code: number;
    data?: any;

    constructor(error: IKernelPluginRpcError) {
        super(error.message);

        this.code = error.code;
        this.data = error.data;
    }
}
