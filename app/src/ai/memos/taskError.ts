type TaskFailure = {error?: string; results?: Array<{error?: string; saved?: boolean}> | null};
type ErrorMessages = {target: string; changed: string; partial: string; intent: string; generic: string; model: Record<number, string>};

const categories = new Map<string, "target" | "changed" | "partial" | "intent">([
    ["memory request intent is ambiguous; clarify the update", "intent"],
    ["memory proposal does not match forget intent", "intent"],
    ["memory proposal does not match remember intent", "intent"],
    ["forget request is ambiguous or not explicitly authorized", "intent"],
    ["forget requires a direct unquoted manual request", "intent"],
    ["submit memory saving and forgetting as separate requests", "intent"],
    ["memory forget request found no matching target", "target"],
    ["proposal target not in verified snapshot", "target"],
    ["proposal identity does not match target", "target"],
    ["forget target is not in verified snapshot", "target"],
    ["forget target does not match verified snapshot", "target"],
    ["replacement target is not in the permitted verified snapshot", "target"],
    ["memory revision conflict", "changed"],
    ["memory has been withdrawn", "changed"],
    ["memory source changed; retry explicitly", "changed"],
    ["memory proposal sources changed; retry explicitly", "changed"],
    ["memory proposal sources changed before commit", "changed"],
    ["memory sources changed before activation", "changed"],
    ["forget target sources changed; retry explicitly", "changed"],
    ["forget candidate snapshot changed; retry explicitly", "changed"],
    ["some memory proposals were not saved; saved memories remain available", "partial"],
]);

// 逐项错误可能包含底层路径或提供方正文，只展示明确的内部分类和本地受控模型消息。
export const memoryTaskErrorMessage = (task: TaskFailure, messages: ErrorMessages) => {
    const result = new Set<string>();
    const errors = [task.error, ...(task.results || []).slice(0, 64).map(item => item.error)]
        .filter(error => typeof error === "string" && error.length > 0 && error.length <= 1024);
    if (errors.some(error => categories.get(error) === "partial") ||
        (task.results?.some(item => item.saved) && task.results.some(item => !!item.error))) {
        result.add(messages.partial);
    }
    for (const error of errors) {
        const category = categories.get(error);
        if (category) { result.add(messages[category]); continue; }
        for (let code = 448; code <= 459; code++) {
            const modelMessage = messages.model[code];
            if (typeof modelMessage === "string" && modelMessage &&
                error === modelMessage) {
                result.add(modelMessage);
                break;
            }
        }
    }
    return [...result].slice(0, 4).map(message => message.slice(0, 512)).join("\n") || messages.generic;
};
