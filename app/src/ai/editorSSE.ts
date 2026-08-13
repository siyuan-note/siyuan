export interface IAIEditorMessage {
    role: "user" | "assistant";
    content: string;
}

export interface IAIEditorChatRequest {
    taskID: string;
    ids?: string[];
    input?: string;
    action?: string;
    history?: IAIEditorMessage[];
}

export type TAIEditorSSEEvent = {
    type: "start";
    taskID: string;
} | {
    type: "reasoning";
    token: string;
} | {
    type: "content";
    token: string;
} | {
    type: "truncated";
    message: string;
} | {
    type: "error";
    message: string;
} | {
    type: "done";
    finishReason: string;
};

interface IAIEditorSSEParserState {
    buffer: string;
    event: string;
}

export const createAIEditorSSEParserState = (): IAIEditorSSEParserState => ({buffer: "", event: ""});

const buildEvent = (event: string, data: Record<string, unknown>): TAIEditorSSEEvent | undefined => {
    switch (event) {
        case "start":
            return {type: "start", taskID: String(data.taskID || "")};
        case "content":
            return {type: "content", token: String(data.token || "")};
        case "reasoning":
            return {type: "reasoning", token: String(data.token || "")};
        case "truncated":
            return {type: "truncated", message: String(data.message || "")};
        case "error":
            return {type: "error", message: String(data.message || "")};
        case "done":
            return {type: "done", finishReason: String(data.finishReason || "")};
    }
};

export const parseAIEditorSSE = (state: IAIEditorSSEParserState, chunk: string, flush = false) => {
    const events: TAIEditorSSEEvent[] = [];
    state.buffer += chunk;
    const lines = state.buffer.split("\n");
    state.buffer = flush ? "" : lines.pop() || "";
    for (let line of lines) {
        if (line.endsWith("\r")) {
            line = line.slice(0, -1);
        }
        if (line.startsWith("event:")) {
            state.event = line.slice(6).trim();
            continue;
        }
        if (!line.startsWith("data:") || !state.event) {
            continue;
        }
        try {
            const event = buildEvent(state.event, JSON.parse(line.slice(5).trim()));
            if (event) {
                events.push(event);
            }
        } catch (e) {
            // 忽略格式错误的单条事件，后续完整事件仍可继续处理。
        }
        state.event = "";
    }
    if (flush && state.buffer) {
        state.buffer = "";
    }
    return events;
};

export const fetchAIEditorSSE = async (
    request: IAIEditorChatRequest,
    onEvent: (event: TAIEditorSSEEvent) => void,
    signal: AbortSignal,
) => {
    const response = await fetch("/api/ai/editor/chat", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(request),
        signal,
    });
    const contentType = response.headers.get("Content-Type") || "";
    if (!response.ok || !contentType.includes("text/event-stream")) {
        let message = window.siyuan.languages._kernel[28];
        try {
            const data = await response.json();
            message = data?.msg || data?.message || message;
        } catch (e) {
            // 响应不是 JSON 时使用统一错误文案。
        }
        throw new Error(message);
    }
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error(window.siyuan.languages._kernel[28]);
    }
    const decoder = new TextDecoder();
    const parserState = createAIEditorSSEParserState();
    let terminalReceived = false;
    while (true) {
        const result = await reader.read();
        if (result.done) {
            break;
        }
        parseAIEditorSSE(parserState, decoder.decode(result.value, {stream: true})).forEach(event => {
            terminalReceived = terminalReceived || event.type === "done" || event.type === "error";
            onEvent(event);
        });
    }
    parseAIEditorSSE(parserState, decoder.decode(), true).forEach(event => {
        terminalReceived = terminalReceived || event.type === "done" || event.type === "error";
        onEvent(event);
    });
    if (!terminalReceived && !signal.aborted) {
        throw new Error(window.siyuan.languages._kernel[28]);
    }
};
