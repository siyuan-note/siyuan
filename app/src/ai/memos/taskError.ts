type TaskFailure = {error?: string; results?: Array<{error?: string; saved?: boolean}> | null};
type ErrorMessages = {target: string; changed: string; partial: string; intent: string; limit: string; read: string; generic: string; model: Record<number, string>};

const categories = new Map<string, "target" | "changed" | "partial" | "intent" | "format" | "limit" | "read">([
    ["unknown memory proposal operation", "format"],
    ["multiple memory actions target the same record", "format"],
    ["duplicate memory proposal action", "format"],
    ["unexpected trailing model output", "format"],
    ["invalid forget verification", "format"],
    ["invalid forget verification targets", "format"],
    ["invalid memory forget selection", "format"],
    ["invalid memory keyword response", "format"],
    ["invalid memory validity timestamp", "format"],
    ["memory validity timestamp is not explicit in evidence", "format"],
    ["memory validity interval is empty or reversed", "format"],
    ["proposal has no grounded evidence", "format"],
    ["proposal scope is not permitted", "format"],
    ["proposal source is invalid", "format"],
    ["memory input exceeds selected model context budget", "limit"],
    ["memory proposal too large", "limit"],
    ["memory proposal exceeds batch budget", "limit"],
    ["memory candidate context exceeds budget; narrow the request", "limit"],
    ["forget verification context exceeds budget", "limit"],
    ["forget verification exceeds budget", "limit"],
    ["memory source exceeds processing budget", "limit"],
    ["memory sources exceed processing budget; select fewer blocks", "limit"],
    ["conversation source exceeds budget", "limit"],
    ["memory native source exceeds processing budget", "limit"],
    ["memory database columns exceed processing budget", "limit"],
    ["memory database rows exceed processing budget", "limit"],
    ["memory overview exceeds budget", "limit"],
    ["memory scan incomplete", "read"],
    ["memory scope scan incomplete", "read"],
    ["memory search incomplete; narrow the source before retrying", "read"],
    ["some memory records could not be validated", "read"],
    ["memory native source unavailable", "read"],
    ["invalid memory database reference", "read"],
    ["invalid memory database source", "read"],
    ["invalid memory database column", "read"],
    ["invalid memory database value", "read"],
    ["memory source is unavailable or encrypted", "read"],
    ["memory source no longer exists", "read"],
    ["memory source or scope is not available", "read"],
    ["memory overview scan incomplete", "read"],
    ["memory overview sources require review", "read"],
    ["memory sources require review; restore access or create a new explicitly confirmed record", "read"],
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
    ["memory candidate sources changed before model request", "changed"],
    ["memory saving cannot change an inactive forget target", "changed"],
    ["memory configuration changed; retry explicitly", "changed"],
    ["memory configuration changed", "changed"],
    ["memory workspace changed", "changed"],
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
        if (category) {
            result.add(category === "format" ? (messages.model[456] || messages.generic) : messages[category]);
            continue;
        }
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
