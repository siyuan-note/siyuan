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
};

export async function fetchAgentSSE(
    messages: Array<{role: string; content: string}>,
    language: string,
    references: Array<{id: string; title: string}>,
    onEvent: (event: ISSEResult) => void,
    onError: (err: Error) => void,
    signal?: AbortSignal,
): Promise<void> {
    try {
        var response = await fetch("/api/ai/agent/chat", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({messages: messages, language: language, references: references}),
            signal: signal,
        });

        if (!response.ok) {
            var text = await response.text();
            onError(new Error("HTTP " + response.status + ": " + (text || response.statusText)));
            return;
        }

        var reader = response.body ? response.body.getReader() : null;
        if (!reader) {
            onError(new Error("Response body is not readable"));
            return;
        }

        var decoder = new TextDecoder();
        var buffer = "";
        var currentEvent = "";

        while (true) {
            var readResult = await reader.read();
            if (readResult.done) {
                break;
            }

            buffer += decoder.decode(readResult.value, {stream: true});
            var lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (line.indexOf("event:") === 0) {
                    currentEvent = line.slice(6).trim();
                } else if (line.indexOf("data:") === 0) {
                    var dataStr = line.slice(5).trim();
                    if (currentEvent && dataStr) {
                        try {
                            var data = JSON.parse(dataStr);
                            var result = buildSSEResult(currentEvent, data);
                            if (result) {
                                onEvent(result);
                            }
                         } catch (e) {
                            // skip malformed data
                        }
                    }
                    currentEvent = "";
                }
            }
        }
    } catch (err) {
        var e = err as Error;
        if (e.name !== "AbortError") {
            onError(e);
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
        default:
            return null;
    }
}
