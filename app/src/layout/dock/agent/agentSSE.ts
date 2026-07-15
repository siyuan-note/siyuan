export type IToolEffects = {
    localRead?: boolean;
    localWrite?: boolean;
    dataEgress?: boolean;
    externalCost?: boolean;
};

export type ISSEResult = {
    type: "turn";
    turnID: string;
} | {
    type: "content";
    token: string;
} | {
    type: "thinking";
    reasoning: string;
} | {
    type: "tool_call";
    name: string;
    arguments: Record<string, unknown>;
} | {
    type: "confirm";
    name: string;
    arguments: Record<string, unknown>;
    confirmID: string;
    effects?: IToolEffects;
} | {
    type: "tool_result";
    name: string;
    result: string;
} | {
    type: "error";
    message: string;
} | {
    type: "interrupted";
    message: string;
} | {
    type: "done";
    turnID: string;
} | {
    type: "usage";
    promptTokens: number;
    completionTokens: number;
    lastPromptTokens: number;
    tokenBreakdown: Record<string, number>;
    cachedTokens: number;
    contextLimit: number;
} | {
    type: "retry";
    attempt: number;
    maxRetries: number;
} | {
    type: "question";
    questionID: string;
    arguments: Record<string, unknown>;
} | {
    type: "reasoning";
    token: string;
} | {
    type: "snapshot";
    snapshotID: string;
} | {
    type: "frontend_tool_call";
    callID: string;
    name: string;
    arguments: Record<string, unknown>;
};

import {Constants} from "../../../constants";

export type IEditorContext = {
    activeDocID?: string;
    activeDocTitle?: string;
    notebookID?: string;
    focusedBlockID?: string;
    selectedBlockIDs?: string[];
    visibleBlockIDs?: string[];
};

// AgentHttpError 承载 HTTP 状态码，调用方可据此区分"互斥拒绝"(409) 等语义错误。
export class AgentHttpError extends Error {
    public status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = "AgentHttpError";
        this.status = status;
    }
}

export async function fetchAgentSSE(
    message: string,
    language: string,
    references: Array<{id: string; title: string}>,
    onEvent: (event: ISSEResult) => void | Promise<void>,
    onError: (err: Error) => void | Promise<void>,
    signal?: AbortSignal,
    sessionID?: string,
    model?: string,
    reasoningEffort?: string,
    regenerate?: boolean,
    editorContext?: IEditorContext,
    pluginActions?: Array<{name: string; description: string}>,
    userEntryID?: string,
    contentRevision?: number,
): Promise<void> {
    let errorReported = false;
    const reportError = async (err: Error) => {
        if (errorReported) {
            return;
        }
        errorReported = true;
        try {
            await onError(err);
        } catch (handlerErr) {
            console.error("agent SSE error handler failed:", handlerErr);
        }
    };
    try {
        const body: Record<string, unknown> = {message: message, language: language, references: references};
        if (sessionID) { body.sessionID = sessionID; }
        if (model) { body.model = model; }
        if (reasoningEffort) { body.reasoningEffort = reasoningEffort; }
        if (regenerate) { body.regenerate = regenerate; }
        if (editorContext) { body.editorContext = editorContext; }
        if (pluginActions && pluginActions.length > 0) { body.pluginActions = pluginActions; }
        if (userEntryID) { body.userEntryID = userEntryID; }
        if (typeof contentRevision === "number") { body.contentRevision = contentRevision; }

        const response = await fetch("/api/ai/agent/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // 标识发起者 app，后端据此排除发起者自身的 ws 广播，并做实例级互斥。
                "X-SiYuan-App-ID": Constants.SIYUAN_APPID,
            },
            body: JSON.stringify(body),
            signal: signal,
        });

        if (!response.ok) {
            // 409 表示该会话正在其他实例对话中（实例级互斥）。优先用后端返回的 msg，否则用 i18n 兜底。
            let msg = window.siyuan.languages._kernel[28];
            if (response.status === 409) {
                try {
                    const data = await response.json();
                    if (data && data.msg) { msg = data.msg; }
                } catch (e) {
                    // 读取 JSON 失败时使用 i18n
                }
                msg = window.siyuan.languages.agentChatBusy || msg;
            }
            await reportError(new AgentHttpError(msg, response.status));
            return;
        }

        // 后端在无 provider/无模型等前置错误时返回 HTTP 200 + JSON 包络 {code:-1, msg}（非 SSE 流），
        // 此时 Content-Type 为 application/json 而非 text/event-stream。检测并转 onError，避免静默卡死。
        const contentType = response.headers.get("Content-Type") || "";
        if (contentType.indexOf("text/event-stream") === -1) {
            try {
                const text = await response.text();
                const data = text ? JSON.parse(text) : null;
                const errMsg = (data && (data.msg || data.message)) || window.siyuan.languages._kernel[28];
                await reportError(new AgentHttpError(errMsg, response.status));
            } catch (e) {
                await reportError(new Error(window.siyuan.languages._kernel[28]));
            }
            return;
        }

        const reader = response.body ? response.body.getReader() : null;
        if (!reader) {
            await reportError(new Error(window.siyuan.languages._kernel[28]));
            return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "";
        let terminalReceived = false;

        while (true) {
            const readResult = await reader.read();
            if (readResult.done) {
                break;
            }

            buffer += decoder.decode(readResult.value, {stream: true});
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.indexOf("event:") === 0) {
                    currentEvent = line.slice(6).trim();
                } else if (line.indexOf("data:") === 0) {
                    const dataStr = line.slice(5).trim();
                    if (currentEvent && dataStr) {
                        let result: ISSEResult | null = null;
                        try {
                            result = buildSSEResult(currentEvent, JSON.parse(dataStr));
                        } catch (e) {
                            // skip malformed data
                        }
                        if (result) {
                            await onEvent(result);
                            terminalReceived = result.type === "done" || result.type === "error" ||
                                result.type === "interrupted" || terminalReceived;
                        }
                    }
                    currentEvent = "";
                }
            }
        }

        buffer += decoder.decode();
        if (buffer) {
            const line = buffer.trim();
            if (line.indexOf("data:") === 0 && currentEvent) {
                const dataStr = line.slice(5).trim();
                if (dataStr) {
                    let result: ISSEResult | null = null;
                    try {
                        result = buildSSEResult(currentEvent, JSON.parse(dataStr));
                    } catch (e) {
                        // skip malformed data
                    }
                    if (result) {
                        await onEvent(result);
                        terminalReceived = result.type === "done" || result.type === "error" ||
                            result.type === "interrupted" || terminalReceived;
                    }
                }
            }
        }
        if (!terminalReceived && !signal?.aborted) {
            await reportError(new Error(window.siyuan.languages._kernel[28]));
        }
    } catch (err) {
        const e = err as Error;
        if (e.name !== "AbortError") {
            const msg = e.message.toLowerCase();
            if (msg.indexOf("timeout") !== -1 || msg.indexOf("deadline") !== -1) {
                await reportError(new Error(window.siyuan.languages._kernel[24]));
            } else {
                await reportError(new Error(window.siyuan.languages._kernel[28]));
            }
        }
    }
}

function buildSSEResult(event: string, data: Record<string, unknown>): ISSEResult | null {
    switch (event) {
        case "turn":
            return {type: "turn", turnID: data.turnID as string};
        case "content":
            return {type: "content", token: data.token as string};
        case "thinking":
            return {type: "thinking", reasoning: data.reasoning as string};
        case "tool_call":
            return {
                type: "tool_call",
                name: data.name as string,
                arguments: (data.arguments || {}) as Record<string, unknown>,
            };
        case "confirm":
            return {
                type: "confirm",
                name: data.name as string,
                arguments: (data.arguments || {}) as Record<string, unknown>,
                confirmID: data.confirmID as string,
            };
        case "tool_result":
            return {
                type: "tool_result",
                name: data.name as string,
                result: data.result as string,
            };
        case "error":
            return {type: "error", message: data.message as string};
        case "interrupted":
            return {type: "interrupted", message: data.message as string};
        case "done":
            return {type: "done", turnID: data.turnID as string};
        case "usage":
            return {
                type: "usage",
                promptTokens: (data.promptTokens as number) || 0,
                completionTokens: (data.completionTokens as number) || 0,
                lastPromptTokens: (data.lastPromptTokens as number) || 0,
                tokenBreakdown: (data.tokenBreakdown as Record<string, number>) || {},
                cachedTokens: (data.cachedTokens as number) || 0,
                contextLimit: (data.contextLimit as number) || 0,
            };
        case "retry":
            return {
                type: "retry",
                attempt: (data.attempt as number) || 1,
                maxRetries: (data.maxRetries as number) || 1,
            };
        case "question":
            return {
                type: "question",
                questionID: data.questionID as string,
                arguments: (data.arguments || {}) as Record<string, unknown>,
            };
        case "reasoning":
            return {type: "reasoning", token: data.token as string};
        case "snapshot":
            return {type: "snapshot", snapshotID: data.snapshotID as string};
        case "frontend_tool_call":
            return {
                type: "frontend_tool_call",
                callID: data.callID as string,
                name: data.name as string,
                arguments: (data.arguments || {}) as Record<string, unknown>,
            };
        default:
            return null;
    }
}
