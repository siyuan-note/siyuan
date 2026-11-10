// Escape HTML script boundaries as well as JavaScript string delimiters.
export const toScriptLiteral = (value: unknown): string => {
    return (JSON.stringify(value) ?? "undefined").replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
};
