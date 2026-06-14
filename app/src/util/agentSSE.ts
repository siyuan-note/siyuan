export type ISSEResult = {
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
} | {
    type: "tool_result";
    name: string;
    result: string;
} | {
    type: "error";
    message: string;
} | {
    type: "done";
} | {
    type: "usage";
    promptTokens: number;
    completionTokens: number;
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
};

export type IEditorContext = {
    activeDocID?: string;
    focusedBlockID?: string;
    selectedBlockIDs?: string[];
};

export async function fetchAgentSSE(
    message: string,
    language: string,
    references: Array<{id: string; title: string}>,
    onEvent: (event: ISSEResult) => void | Promise<void>,
    onError: (err: Error) => void,
    signal?: AbortSignal,
    sessionID?: string,
    model?: string,
    regenerate?: boolean,
    editorContext?: IEditorContext,
): Promise<void> {
    try {
        const body: Record<string, unknown> = {message: message, language: language, references: references};
        if (sessionID) { body.sessionID = sessionID; }
        if (model) { body.model = model; }
        if (regenerate) { body.regenerate = regenerate; }
        if (editorContext) { body.editorContext = editorContext; }

        const response = await fetch("/api/ai/agent/chat", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body),
            signal: signal,
        });

        if (!response.ok) {
            onError(new Error(window.siyuan.languages._kernel[28]));
            return;
        }

        const reader = response.body ? response.body.getReader() : null;
        if (!reader) {
            onError(new Error(window.siyuan.languages._kernel[28]));
            return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "";

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
                        try {
                            const data = JSON.parse(dataStr);
                            const result = buildSSEResult(currentEvent, data);
                            if (result) {
                                await onEvent(result);
                            }
                        } catch (e) {
                            // skip malformed data
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
                    try {
                        const data = JSON.parse(dataStr);
                        const result = buildSSEResult(currentEvent, data);
                        if (result) {
                            await onEvent(result);
                        }
                    } catch (e) {
                        // skip malformed data
                    }
                }
            }
        }
    } catch (err) {
        const e = err as Error;
        if (e.name !== "AbortError") {
            const msg = e.message.toLowerCase();
            if (msg.indexOf("timeout") !== -1 || msg.indexOf("deadline") !== -1) {
                onError(new Error(window.siyuan.languages._kernel[24]));
            } else {
                onError(new Error(window.siyuan.languages._kernel[28]));
            }
        }
    }
}

function buildSSEResult(event: string, data: Record<string, unknown>): ISSEResult | null {
    switch (event) {
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
        case "done":
            return {type: "done"};
        case "usage":
            return {
                type: "usage",
                promptTokens: (data.promptTokens as number) || 0,
                completionTokens: (data.completionTokens as number) || 0,
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
        default:
            return null;
    }
}
