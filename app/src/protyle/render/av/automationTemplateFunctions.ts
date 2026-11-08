import type {AVAutomationRuleInput} from "../../../types/api";

export const automationTemplateFunctions = (source: string) => {
    const functions = new Set<string>();
    let action = false;
    let quote = "";
    let comment = false;
    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        if (!action) {
            if (source.startsWith(".action{", index)) { action = true; index += 7; }
        } else if (comment) {
            if (source.startsWith("*/", index)) { comment = false; index++; }
        } else if (quote) {
            if (char === "\\" && quote !== "`") index++;
            else if (char === quote) quote = "";
        } else if (char === '"' || char === "'" || char === "`") {
            quote = char;
        } else if (source.startsWith("/*", index)) {
            comment = true;
            index++;
        } else if (char === "}") {
            action = false;
        } else if (/[a-zA-Z_]/.test(char)) {
            const start = index;
            while (index + 1 < source.length && /[a-zA-Z_0-9]/.test(source[index + 1])) index++;
            if (source[start - 1] !== "$" && source[start - 1] !== ".") functions.add(source.slice(start, index + 1));
        }
    }
    return functions;
};

export const automationRuleFunctions = (rule: Pick<AVAutomationRuleInput, "actions">) => new Set(rule?.actions?.flatMap(action =>
    Object.values(action?.fields || {}).flatMap(value => value?.mode === "template" ? [...automationTemplateFunctions(value.template || "")] : [])));

export const automationTemplateSpec = (rule: Pick<AVAutomationRuleInput, "trigger" | "actions">) => {
    const functions = automationRuleFunctions(rule);
    return ["printf", "urlquery", "dict", "toString", ...(rule.trigger === "manual" ? [] : ["httpGet", "fromJson"])].some(name => functions.has(name)) ? 10 : 1;
};
